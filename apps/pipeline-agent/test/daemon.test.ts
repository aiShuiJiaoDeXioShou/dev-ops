import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import type {
  AgentArtifactUploadResponse,
  AgentCompleteRequest,
  AgentCompleteResponse,
  AgentHeartbeatResponse,
  AgentLeaseRenewResponse,
  AgentLogChunk,
  AgentLogsResponse,
  AgentStepStatusRequest,
  AgentStepStatusResponse,
  PipelineLease,
} from '@dev-ops/pipeline-protocol'

import type { AgentClient, AgentSessionInfo } from '../src/agent.ts'
import { loadAgentConfig } from '../src/config.ts'
import type { CreateJobContainerInput, DockerRuntime, JobContainer } from '../src/docker.ts'
import { AGENT_ERROR_CODES, AgentApiError } from '../src/errors.ts'
import { createRunPlan, createStep } from './helpers/fixtures.ts'

interface FakeClientState {
  heartbeats: (string | null)[]
  statuses: { stepIndex: number; body: AgentStepStatusRequest }[]
  completed: AgentCompleteRequest[]
  leaseCalls: number
}

interface FakeClient extends AgentClient {
  state: FakeClientState
}

function createFakeClient(options: {
  lease: PipelineLease
  cancelRunningLease: boolean
  registerError?: Error
  leaseExpiredOnStatus?: boolean
}): FakeClient {
  const state: FakeClientState = { heartbeats: [], statuses: [], completed: [], leaseCalls: 0 }
  const session: AgentSessionInfo = {
    nodeId: 'fake-node',
    protocolVersion: 1,
    heartbeatIntervalSeconds: 1,
    leaseTtlSeconds: 90,
  }
  return {
    state,
    hasAgentToken: true,
    async ensureRegistered(): Promise<AgentSessionInfo> {
      if (options.registerError) throw options.registerError
      return session
    },
    async heartbeat(runningLeaseId: string | null): Promise<AgentHeartbeatResponse> {
      state.heartbeats.push(runningLeaseId)
      const cancelLeaseIds =
        options.cancelRunningLease && runningLeaseId !== null ? [options.lease.leaseId] : ([] as string[])
      return { cancelLeaseIds, heartbeatIntervalSeconds: 1 }
    },
    async acquireLease(): Promise<PipelineLease | null> {
      state.leaseCalls += 1
      if (state.leaseCalls > 1) {
        await new Promise((resolve) => setTimeout(resolve, 20))
        return null
      }
      return options.lease
    },
    async renewLease(): Promise<AgentLeaseRenewResponse> {
      return { expiresAt: options.lease.expiresAt, cancelRequested: false }
    },
    async reportStepStatus(
      _lease: PipelineLease,
      stepIndex: number,
      body: AgentStepStatusRequest,
    ): Promise<AgentStepStatusResponse> {
      state.statuses.push({ stepIndex, body })
      if (options.leaseExpiredOnStatus) {
        throw new AgentApiError(AGENT_ERROR_CODES.leaseExpired, '租约已过期')
      }
      return { stepIndex, status: body.status }
    },
    async uploadLogs(_lease: PipelineLease, chunks: readonly AgentLogChunk[]): Promise<AgentLogsResponse> {
      const acceptedThrough: Record<string, number> = {}
      for (const chunk of chunks) acceptedThrough[String(chunk.stepIndex)] = chunk.seq
      return { acceptedThrough }
    },
    async uploadArtifact(): Promise<AgentArtifactUploadResponse> {
      throw new Error('本测试不应上传产物')
    },
    async complete(_lease: PipelineLease, body: AgentCompleteRequest): Promise<AgentCompleteResponse> {
      state.completed.push(body)
      return { runId: options.lease.run.runId, status: body.status }
    },
  }
}

/** 假的 Docker 运行时：exec 等待信号中止或 5 秒后成功，用于验证取消/中断路径。 */
function createFakeDocker(): { docker: DockerRuntime; state: { execRecords: string[]; removed: number } } {
  const state = { execRecords: [] as string[], removed: 0 }
  const docker: DockerRuntime = {
    async ping(): Promise<void> {
      return undefined
    },
    async ensureImage(): Promise<void> {
      return undefined
    },
    async createJobContainer(_input: CreateJobContainerInput): Promise<JobContainer> {
      return {
        id: 'fake-container',
        async exec(input): Promise<{ exitCode: number; timedOut: boolean; cancelled: boolean }> {
          state.execRecords.push(input.script)
          if (input.signal.aborted) return { exitCode: -1, timedOut: false, cancelled: true }
          return new Promise((resolve) => {
            const timer = setTimeout(() => {
              input.signal.removeEventListener('abort', onAbort)
              resolve({ exitCode: 0, timedOut: false, cancelled: false })
            }, 5_000)
            const onAbort = (): void => {
              clearTimeout(timer)
              resolve({ exitCode: -1, timedOut: false, cancelled: true })
            }
            input.signal.addEventListener('abort', onAbort, { once: true })
          })
        },
        async remove(): Promise<void> {
          state.removed += 1
        },
      }
    },
  }
  return { docker, state }
}

interface DaemonTestContext {
  workDir: string
  controller: AbortController
  client: FakeClient
  docker: DockerRuntime
  dockerState: { execRecords: string[]; removed: number }
  logLines: string[]
  cleanup(): Promise<void>
}

async function createDaemonContext(options: {
  cancelRunningLease: boolean
  registerError?: Error
  leaseExpiredOnStatus?: boolean
}): Promise<DaemonTestContext> {
  const workDir = await mkdtemp(join(tmpdir(), 'devops-agent-daemon-'))
  const plan = createRunPlan({
    runId: 'run-daemon-1',
    jobs: [
      {
        id: 'build',
        name: '构建',
        image: 'fake-image:1',
        runsOn: ['linux'],
        timeoutSeconds: 120,
        steps: [createStep(0, { run: 'sleep 30', timeoutSeconds: 120 })],
      },
    ],
  })
  const lease: PipelineLease = {
    leaseId: 'lease-daemon-1',
    leaseToken: 'lease-token-daemon-012345678901234567',
    expiresAt: new Date(Date.now() + 90_000).toISOString(),
    heartbeatIntervalSeconds: 1,
    run: plan,
  }
  const client = createFakeClient({
    lease,
    cancelRunningLease: options.cancelRunningLease,
    ...(options.registerError ? { registerError: options.registerError } : {}),
    ...(options.leaseExpiredOnStatus ? { leaseExpiredOnStatus: options.leaseExpiredOnStatus } : {}),
  })
  const fakeDocker = createFakeDocker()
  return {
    workDir,
    controller: new AbortController(),
    client,
    docker: fakeDocker.docker,
    dockerState: fakeDocker.state,
    logLines: [],
    async cleanup(): Promise<void> {
      await rm(workDir, { recursive: true, force: true })
    },
  }
}

function configFor(workDir: string) {
  return loadAgentConfig({
    PLATFORM_URL: 'http://127.0.0.1:1',
    AGENT_TOKEN: 'agent-token-012345678901234567890123456789',
    AGENT_WORK_DIR: workDir,
    AGENT_LABELS: 'linux',
    AGENT_POLL_WAIT_SECONDS: '0',
  })
}

async function pollUntil(predicate: () => boolean, timeoutMs: number, label: string): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`等待超时：${label}`)
}

test('daemon：运行中心跳下发取消时立即停止并上报 cancelled', async () => {
  const { runAgentDaemon } = await import('../src/daemon.ts')
  const context = await createDaemonContext({ cancelRunningLease: true })
  try {
    const daemon = runAgentDaemon({
      config: configFor(context.workDir),
      signal: context.controller.signal,
      client: context.client,
      docker: context.docker,
      writeLog: (line) => context.logLines.push(line),
    })
    await pollUntil(() => context.client.state.completed.length > 0, 20_000, '完成上报')
    context.controller.abort()
    await daemon
    assert.equal(context.client.state.completed[0]?.status, 'cancelled')
    assert.ok(
      context.client.state.statuses.some((item) => item.stepIndex === 0 && item.body.status === 'cancelled'),
      '运行中步骤应上报 cancelled',
    )
    assert.equal(context.dockerState.removed, 1, '容器应被清理')
  } finally {
    await context.cleanup()
  }
})

test('daemon：收到退出信号时按 interrupted 收口当前租约且日志不含令牌', async () => {
  const { runAgentDaemon } = await import('../src/daemon.ts')
  const context = await createDaemonContext({ cancelRunningLease: false })
  try {
    const daemon = runAgentDaemon({
      config: configFor(context.workDir),
      signal: context.controller.signal,
      client: context.client,
      docker: context.docker,
      writeLog: (line) => context.logLines.push(line),
    })
    await pollUntil(
      () => context.client.state.statuses.some((item) => item.body.status === 'running'),
      20_000,
      '步骤开始执行',
    )
    context.controller.abort()
    await daemon
    assert.equal(context.client.state.completed[0]?.status, 'interrupted')
    assert.equal(context.dockerState.removed, 1, '容器应被清理')
    assert.ok(!context.logLines.join('\n').includes('agent-token-'), '日志不得包含 Agent 令牌')
  } finally {
    await context.cleanup()
  }
})

test('daemon：令牌无效等终止性错误会让进程以异常结束', async () => {
  const { runAgentDaemon } = await import('../src/daemon.ts')
  const context = await createDaemonContext({
    cancelRunningLease: false,
    registerError: new AgentApiError(AGENT_ERROR_CODES.tokenInvalid, '令牌无效'),
  })
  try {
    await assert.rejects(
      () =>
        runAgentDaemon({
          config: configFor(context.workDir),
          signal: context.controller.signal,
          client: context.client,
          docker: context.docker,
          writeLog: () => undefined,
        }),
      (error: unknown) => error instanceof AgentApiError && error.code === AGENT_ERROR_CODES.tokenInvalid,
    )
  } finally {
    await context.cleanup()
  }
})

test('daemon：租约过期时停止本地执行、清理且不上报完成', async () => {
  const { runAgentDaemon } = await import('../src/daemon.ts')
  const context = await createDaemonContext({ cancelRunningLease: false, leaseExpiredOnStatus: true })
  try {
    const daemon = runAgentDaemon({
      config: configFor(context.workDir),
      signal: context.controller.signal,
      client: context.client,
      docker: context.docker,
      writeLog: (line) => context.logLines.push(line),
    })
    await pollUntil(() => context.logLines.some((line) => line.includes('跳过完成上报')), 20_000, '跳过完成上报')
    context.controller.abort()
    await daemon
    assert.equal(context.client.state.completed.length, 0, '租约过期后不得再写平台完成结果')
    assert.equal(context.dockerState.removed, 1, '租约过期后必须清理容器')
    assert.ok(
      context.logLines.some((line) => line.includes('租约已失效')),
      '应记录租约失效原因',
    )
  } finally {
    await context.cleanup()
  }
})
