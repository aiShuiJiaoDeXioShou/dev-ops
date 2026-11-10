import { hostname } from 'node:os'

/** 容器资源限制；P1 每次运行只创建一个任务容器，限制用于隔离过度占用。 */
export interface AgentContainerLimits {
  /** CPU 核数，可为小数；Docker 侧换算为 NanoCpus。 */
  cpus: number
  /** 内存上限，单位字节；不使用交换内存。 */
  memoryBytes: number
  /** 容器内最大进程数，防止 fork 炸弹耗尽宿主机。 */
  pidsLimit: number
}

/**
 * Agent 启动配置；由环境变量提供，避免把令牌写入命令行历史。
 *
 * 环境变量：PLATFORM_URL（平台地址）、AGENT_REGISTRATION_TOKEN 或 AGENT_TOKEN（二选一）、
 * AGENT_NAME（注册节点名，默认主机名）、AGENT_WORK_DIR（宿主工作目录）、AGENT_LABELS（能力标签）、
 * 以及可选的轮询/超时/容器资源限制配置。
 */
export interface AgentConfig {
  platformUrl: string
  registrationToken?: string
  agentToken?: string
  nodeName: string
  workDir: string
  labels: string[]
  /** 租约轮询等待秒数；平台可提前返回。 */
  pollWaitSeconds: number
  /** 普通平台请求超时，单位毫秒。 */
  controlTimeoutMs: number
  /** 产物流式上传超时，单位毫秒。 */
  artifactUploadTimeoutMs: number
  /** 单个产物最大字节数；超过时在本地打包阶段直接失败。 */
  artifactMaxBytes: number
  /** 单个日志分片最大字节数，必须不超过协议上限。 */
  logChunkMaxBytes: number
  container: AgentContainerLimits
  /** 容器运行用户（uid:gid）；缺省使用 Agent 进程用户，Agent 为 root 时回退 1000:1000。 */
  containerUser?: string
  /** Docker Engine socket 地址；缺省使用 dockerode 默认值。 */
  dockerSocketPath?: string
}

function required(value: string | undefined, name: string): string {
  const trimmed = value?.trim()
  if (!trimmed) throw new Error(`缺少必需配置：${name}`)
  return trimmed
}

function validatePlatformUrl(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('PLATFORM_URL 必须是完整的 HTTP(S) URL')
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('PLATFORM_URL 只支持 HTTP(S)，不能包含凭据')
  }
  return url.origin
}

interface IntegerOption {
  name: string
  defaultValue: number
  minimum: number
  maximum: number
}

function integerOption(value: string | undefined, option: IntegerOption): number {
  const trimmed = value?.trim()
  if (!trimmed) return option.defaultValue
  const parsed = Number(trimmed)
  if (!Number.isInteger(parsed) || parsed < option.minimum || parsed > option.maximum) {
    throw new Error(`${option.name} 必须是 ${option.minimum}–${option.maximum} 之间的整数`)
  }
  return parsed
}

function numberOption(
  value: string | undefined,
  name: string,
  defaultValue: number,
  minimum: number,
  maximum: number,
): number {
  const trimmed = value?.trim()
  if (!trimmed) return defaultValue
  const parsed = Number(trimmed)
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} 必须是 ${minimum}–${maximum} 之间的数字`)
  }
  return parsed
}

function optionalContainerUser(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  if (!trimmed) return undefined
  if (!/^\d+:\d+$/.test(trimmed)) throw new Error('AGENT_CONTAINER_USER 必须是 uid:gid 的数字形式')
  return trimmed
}

/**
 * 解析并校验 Agent 环境配置。
 * @param env 进程环境变量，默认读取当前进程。
 * @returns 平台地址、注册/长期令牌、工作目录、能力标签、轮询与容器限制。
 * @throws 缺少平台地址、没有令牌、URL/数值/标签不合法时抛出；错误信息不包含令牌值。
 */
export function loadAgentConfig(env: NodeJS.ProcessEnv = process.env): AgentConfig {
  const platformUrl = validatePlatformUrl(required(env.PLATFORM_URL, 'PLATFORM_URL'))
  const registrationToken = env.AGENT_REGISTRATION_TOKEN?.trim() || undefined
  const agentToken = env.AGENT_TOKEN?.trim() || undefined
  if (!registrationToken && !agentToken) {
    throw new Error('必须提供 AGENT_REGISTRATION_TOKEN 或 AGENT_TOKEN')
  }
  const labels = (env.AGENT_LABELS ?? 'linux,docker,node24')
    .split(',')
    .map((label) => label.trim())
    .filter(Boolean)
  if (labels.length === 0) throw new Error('AGENT_LABELS 不能为空')
  const nodeName = env.AGENT_NAME?.trim() || hostname()
  if (nodeName.length > 120) throw new Error('AGENT_NAME 不能超过 120 个字符')

  const container: AgentContainerLimits = {
    cpus: numberOption(env.AGENT_CONTAINER_CPUS, 'AGENT_CONTAINER_CPUS', 1, 0.1, 16),
    memoryBytes:
      integerOption(env.AGENT_CONTAINER_MEMORY_MB, {
        name: 'AGENT_CONTAINER_MEMORY_MB',
        defaultValue: 2048,
        minimum: 128,
        maximum: 65_536,
      }) *
      1024 *
      1024,
    pidsLimit: integerOption(env.AGENT_CONTAINER_PIDS_LIMIT, {
      name: 'AGENT_CONTAINER_PIDS_LIMIT',
      defaultValue: 512,
      minimum: 16,
      maximum: 65_536,
    }),
  }

  const config: AgentConfig = {
    platformUrl,
    nodeName,
    labels,
    workDir: required(env.AGENT_WORK_DIR, 'AGENT_WORK_DIR'),
    pollWaitSeconds: integerOption(env.AGENT_POLL_WAIT_SECONDS, {
      name: 'AGENT_POLL_WAIT_SECONDS',
      defaultValue: 20,
      minimum: 0,
      maximum: 30,
    }),
    controlTimeoutMs: integerOption(env.AGENT_HTTP_TIMEOUT_MS, {
      name: 'AGENT_HTTP_TIMEOUT_MS',
      defaultValue: 15_000,
      minimum: 1_000,
      maximum: 120_000,
    }),
    artifactUploadTimeoutMs: integerOption(env.AGENT_ARTIFACT_UPLOAD_TIMEOUT_MS, {
      name: 'AGENT_ARTIFACT_UPLOAD_TIMEOUT_MS',
      defaultValue: 300_000,
      minimum: 10_000,
      maximum: 3_600_000,
    }),
    artifactMaxBytes: integerOption(env.AGENT_ARTIFACT_MAX_BYTES, {
      name: 'AGENT_ARTIFACT_MAX_BYTES',
      defaultValue: 524_288_000,
      minimum: 1_048_576,
      maximum: 2_147_483_648,
    }),
    logChunkMaxBytes: integerOption(env.AGENT_LOG_CHUNK_MAX_BYTES, {
      name: 'AGENT_LOG_CHUNK_MAX_BYTES',
      defaultValue: 65_536,
      minimum: 1_024,
      maximum: 262_144,
    }),
    container,
    ...(registrationToken ? { registrationToken } : {}),
    ...(agentToken ? { agentToken } : {}),
  }
  const containerUser = optionalContainerUser(env.AGENT_CONTAINER_USER)
  const dockerSocketPath = env.AGENT_DOCKER_SOCKET?.trim() || undefined
  return {
    ...config,
    ...(containerUser ? { containerUser } : {}),
    ...(dockerSocketPath ? { dockerSocketPath } : {}),
  }
}
