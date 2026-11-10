import { randomUUID } from 'node:crypto'
import { StringDecoder } from 'node:string_decoder'

import Docker from 'dockerode'
import type { Container, ContainerCreateOptions, Exec } from 'dockerode'

import type { AgentContainerLimits } from './config.ts'
import { describeError } from './errors.ts'
import type { AgentLogger } from './logger.ts'

/** 任务容器内的工作区挂载点；工作区在宿主侧由 Agent 准备。 */
export const CONTAINER_WORKSPACE_DIR = '/workspace'
/** 容器保持运行的常驻命令；具体步骤通过 docker exec 执行。 */
const CONTAINER_KEEP_ALIVE_COMMAND = ['sh', '-c', 'while true; do sleep 3600; done']
/** 停止容器后的收尾等待，避免 docker 事件丢失导致步骤永远挂起。 */
const KILL_GRACE_MS = 10_000
/** 镜像拉取超时；私有镜像仓库或大镜像仍必须有限。 */
const DEFAULT_PULL_TIMEOUT_MS = 600_000

/** docker exec 执行一步命令的输入。 */
export interface ContainerExecInput {
  /** shell 脚本；由平台运行计划固定，Agent 不改写。 */
  script: string
  /** 完整环境变量（已按运行/ job /步骤合并并带运行时密钥）。 */
  env: Readonly<Record<string, string>>
  /** 容器内工作目录，必须以工作区挂载点为前缀。 */
  workingDirectory: string
  /** 步骤超时，单位毫秒。 */
  timeoutMs: number
  /** 取消信号；触发时终止容器并返回 cancelled。 */
  signal: AbortSignal
  /** 增量输出回调；内容可能被分块，含多字节字符时已在解码层处理。 */
  onOutput: (text: string) => void
}

/** 一步命令的执行结果；timedOut/cancelled 优先于 exitCode。 */
export interface ContainerExecResult {
  exitCode: number
  timedOut: boolean
  cancelled: boolean
}

/** 一个 job 对应的任务容器；必须显式 remove。 */
export interface JobContainer {
  readonly id: string
  /** 在容器内执行一步命令；超时或取消时终止容器。 */
  exec(input: ContainerExecInput): Promise<ContainerExecResult>
  /** 强制删除容器；失败抛出，调用方需要上报清理失败。 */
  remove(): Promise<void>
}

export interface CreateJobContainerInput {
  image: string
  runId: string
  jobId: string
  /** 宿主工作区绝对路径；只挂载该目录，不挂载 Docker socket。 */
  workspaceDir: string
}

/** Docker 运行时配置。 */
export interface DockerRuntimeOptions {
  socketPath?: string
  limits: AgentContainerLimits
  /** 容器运行用户（uid:gid）；缺省按 Agent 进程用户推导。 */
  containerUser?: string
  pullTimeoutMs?: number
  logger: AgentLogger
}

/** 任务容器所需的 Docker 能力；测试可注入实现，但真实路径必须由 dockerode 完成。 */
export interface DockerRuntime {
  /** 检查 Docker Engine 是否可用；不可用时启动失败。 */
  ping(): Promise<void>
  /** 确保镜像存在，不存在时拉取并等待完成。 */
  ensureImage(image: string): Promise<void>
  /** 创建并启动任务容器，返回 exec/删除句柄。 */
  createJobContainer(input: CreateJobContainerInput): Promise<JobContainer>
}

/** 从 dockerode 错误中安全读取 HTTP 状态码，用于忽略“已删除/已停止”等幂等场景。 */
function dockerStatusCode(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined
  const statusCode = Reflect.get(error, 'statusCode')
  return typeof statusCode === 'number' ? statusCode : undefined
}

/** 容器名只允许安全字符，避免使用非法 Docker 名称。 */
function containerName(runId: string, jobId: string): string {
  const safeRunId = runId.replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 40)
  const safeJobId = jobId.replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 30)
  return `devops-agent-${safeRunId}-${safeJobId}-${randomUUID().slice(0, 8)}`
}

/** 推导容器运行用户：Agent 非 root 时复用它，root 时回退固定非 root。 */
function resolveContainerUser(configured: string | undefined): string {
  if (configured) return configured
  const uid = typeof process.getuid === 'function' ? process.getuid() : undefined
  const gid = typeof process.getgid === 'function' ? process.getgid() : undefined
  if (uid === undefined || gid === undefined) {
    throw new Error('当前平台无法确定宿主用户，请通过 AGENT_CONTAINER_USER 指定容器非 root 用户')
  }
  if (uid === 0) return '1000:1000'
  return `${uid}:${gid}`
}

/**
 * 创建 Docker 运行时封装。
 * @param options socket 地址、资源限制、容器用户、拉取超时与日志器。
 * @returns ping、镜像准备与任务容器创建能力。
 * @remarks
 * - 容器是非 root、drop 到宿主用户、带内存/CPU/pids 限制，并禁用提权。
 * - 只把本次运行的工作区绑定到 /workspace，绝不挂载宿主 Docker socket。
 */
export function createDockerRuntime(options: DockerRuntimeOptions): DockerRuntime {
  const docker = options.socketPath ? new Docker({ socketPath: options.socketPath }) : new Docker()
  const pullTimeoutMs = options.pullTimeoutMs ?? DEFAULT_PULL_TIMEOUT_MS
  const containerUser = resolveContainerUser(options.containerUser)

  async function consumePullStream(stream: NodeJS.ReadableStream, image: string): Promise<void> {
    let pullError: string | undefined
    let settled = false
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        const destroy = Reflect.get(stream, 'destroy')
        if (typeof destroy === 'function') Reflect.apply(destroy, stream, [])
        reject(new Error(`拉取镜像超时：${image}`))
      }, pullTimeoutMs)
      const finish = (error?: Error): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (error) reject(error)
        else resolve()
      }
      stream.on('data', (chunk: Buffer) => {
        // Docker 拉取进度是 JSON 行；错误信息藏在 error 字段而不是流事件里。
        for (const line of chunk.toString('utf8').split('\n')) {
          if (!line.trim()) continue
          try {
            const parsed: unknown = JSON.parse(line)
            if (typeof parsed === 'object' && parsed !== null) {
              const error = Reflect.get(parsed, 'error')
              if (typeof error === 'string') pullError = error
            }
          } catch {
            // 非 JSON 行（心跳空行等）忽略。
          }
        }
      })
      stream.on('end', () => {
        if (pullError) finish(new Error(`拉取镜像失败：${pullError}`))
        else finish()
      })
      stream.on('error', (error: Error) => finish(new Error(`拉取镜像失败：${describeError(error)}`)))
    })
  }

  async function ensureImage(image: string): Promise<void> {
    try {
      await docker.getImage(image).inspect()
      return
    } catch (error) {
      if (dockerStatusCode(error) !== 404) {
        throw new Error(`检查镜像失败：${describeError(error)}`)
      }
    }
    options.logger.info(`本地缺少镜像 ${image}，开始拉取`)
    const stream = await docker.pull(image)
    await consumePullStream(stream, image)
    options.logger.info(`镜像拉取完成：${image}`)
  }

  async function safeKill(container: Container): Promise<void> {
    try {
      await container.kill()
    } catch (error) {
      const status = dockerStatusCode(error)
      if (status === 404 || status === 409) return
      throw new Error(`终止任务容器失败：${describeError(error)}`)
    }
  }

  async function createContainer(
    input: CreateJobContainerInput,
  ): Promise<{ container: Container; exec: (args: ContainerExecInput) => Promise<ContainerExecResult> }> {
    const hostConfig = {
      Binds: [`${input.workspaceDir}:${CONTAINER_WORKSPACE_DIR}`],
      Memory: options.limits.memoryBytes,
      MemorySwap: options.limits.memoryBytes,
      NanoCpus: Math.max(1, Math.round(options.limits.cpus * 1_000_000_000)),
      PidsLimit: options.limits.pidsLimit,
      AutoRemove: false,
      Init: true,
      SecurityOpt: ['no-new-privileges'],
    }
    const createOptions: ContainerCreateOptions = {
      name: containerName(input.runId, input.jobId),
      Image: input.image,
      User: containerUser,
      WorkingDir: CONTAINER_WORKSPACE_DIR,
      Cmd: CONTAINER_KEEP_ALIVE_COMMAND,
      Tty: false,
      AttachStdout: false,
      AttachStderr: false,
      Labels: {
        'devops.agent.run-id': input.runId,
        'devops.agent.job-id': input.jobId,
        'devops.agent.managed': 'true',
      },
      HostConfig: hostConfig,
    }
    let container: Container | undefined
    try {
      container = await docker.createContainer(createOptions)
      await container.start()
    } catch (error) {
      if (container) await safeRemove(container)
      throw new Error(`启动任务容器失败：${describeError(error)}`)
    }
    const running = container
    return {
      container: running,
      exec: (args: ContainerExecInput) => execInContainer(running, args),
    }
  }

  async function safeRemove(container: Container): Promise<void> {
    try {
      await container.remove({ force: true })
    } catch (error) {
      const status = dockerStatusCode(error)
      if (status === 404) return
      throw new Error(`删除任务容器失败：${describeError(error)}`)
    }
  }

  async function execInContainer(container: Container, input: ContainerExecInput): Promise<ContainerExecResult> {
    if (input.signal.aborted) return { exitCode: -1, timedOut: false, cancelled: true }
    const env = Object.entries(input.env).map(([name, value]) => `${name}=${value}`)
    let exec: Exec
    try {
      exec = await container.exec({
        Cmd: ['sh', '-c', input.script],
        Env: env,
        WorkingDir: input.workingDirectory,
        AttachStdout: true,
        AttachStderr: true,
        Tty: true,
      })
    } catch (error) {
      throw new Error(`创建步骤执行进程失败：${describeError(error)}`)
    }
    let stream: NodeJS.ReadableStream
    try {
      stream = await exec.start({ hijack: true, stdin: false, Detach: false, Tty: true })
    } catch (error) {
      throw new Error(`启动步骤执行进程失败：${describeError(error)}`)
    }

    const decoder = new StringDecoder('utf8')
    const streamDone = new Promise<void>((resolve) => {
      stream.on('data', (chunk: Buffer) => input.onOutput(decoder.write(chunk)))
      stream.on('end', () => resolve())
      stream.on('close', () => resolve())
      stream.on('error', () => resolve())
    })
    const outcome = await waitForOutcome(streamDone, input.signal, input.timeoutMs)
    input.onOutput(decoder.end())
    if (outcome !== 'done') {
      try {
        await safeKill(container)
      } catch (error) {
        options.logger.warn(`停止超时/取消的任务容器失败：${describeError(error)}`)
      }
      // 容器被停止后输出流可能迟迟不结束，等待有限时间即可。
      await Promise.race([streamDone, new Promise((resolve) => setTimeout(resolve, KILL_GRACE_MS))])
      return { exitCode: -1, timedOut: outcome === 'timeout', cancelled: outcome === 'aborted' }
    }
    let exitCode = -1
    try {
      const info = await exec.inspect()
      if (info.ExitCode !== null) exitCode = info.ExitCode
    } catch (error) {
      options.logger.warn(`读取步骤退出码失败：${describeError(error)}`)
    }
    return { exitCode, timedOut: false, cancelled: false }
  }

  return {
    async ping(): Promise<void> {
      await docker.ping()
    },

    ensureImage,

    async createJobContainer(input: CreateJobContainerInput): Promise<JobContainer> {
      const created = await createContainer(input)
      return {
        id: created.container.id,
        exec: created.exec,
        async remove(): Promise<void> {
          await safeRemove(created.container)
        },
      }
    },
  }
}

/** 等待输出流结束、超时或取消三种结果之一；结束后清理监听器与定时器。 */
async function waitForOutcome(
  streamDone: Promise<void>,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<'done' | 'timeout' | 'aborted'> {
  let timer: NodeJS.Timeout | undefined
  let abortListener: (() => void) | undefined
  const outcome = new Promise<'done' | 'timeout' | 'aborted'>((resolve) => {
    void streamDone.then(() => resolve('done'))
    if (signal.aborted) {
      resolve('aborted')
      return
    }
    abortListener = () => resolve('aborted')
    signal.addEventListener('abort', abortListener, { once: true })
    timer = setTimeout(() => resolve('timeout'), Math.max(1, timeoutMs))
  })
  try {
    return await outcome
  } finally {
    if (timer) clearTimeout(timer)
    if (abortListener) signal.removeEventListener('abort', abortListener)
  }
}
