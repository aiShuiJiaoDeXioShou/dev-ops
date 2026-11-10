import { readFile } from 'node:fs/promises'

import type {
  AgentLogChunk,
  AgentStepStatusRequest,
  PipelineLease,
  RunPlan,
  RunPlanJob,
  RunPlanStep,
} from '@dev-ops/pipeline-protocol'

import type { ArtifactUploadRequest, RunReportSink } from '../../src/executor.ts'
import { createLogCollector } from '../../src/logs.ts'
import type { AgentLogger } from '../../src/logger.ts'
import type { SecretMasker } from '../../src/masking.ts'

/** 测试固定提交 SHA；长度满足协议 pattern。 */
export const TEST_COMMIT_SHA = 'a'.repeat(40)
/** 测试产物路径占位；workspace 测试会替换为真实目录。 */
export const TEST_WORKSPACE = '/tmp/devops-agent-test-workspace'

/** 构造一个可执行的步骤。 */
export function createStep(index: number, overrides: Partial<RunPlanStep> = {}): RunPlanStep {
  return {
    index,
    name: `步骤 ${String(index)}`,
    kind: 'run',
    run: 'echo hello',
    timeoutSeconds: 60,
    env: {},
    workingDirectory: '.',
    ...overrides,
  }
}

/** 构造一个 job。 */
export function createJob(overrides: Partial<RunPlanJob> = {}): RunPlanJob {
  return {
    id: 'build',
    name: '构建',
    image: 'node:24-bookworm-slim',
    runsOn: ['linux'],
    timeoutSeconds: 600,
    env: {},
    steps: [createStep(0)],
    ...overrides,
  }
}

/** 构造一个运行计划；默认单 job、单 run 步骤。 */
export function createRunPlan(overrides: Partial<RunPlan> = {}): RunPlan {
  return {
    runId: 'run-test-1',
    workflowPath: '.devops/workflows/ci.yml',
    workflowName: 'ci',
    ref: 'main',
    commitSha: TEST_COMMIT_SHA,
    timeoutSeconds: 1_800,
    inputs: {},
    env: { CI: 'true' },
    git: {
      remoteUrl: 'https://example.test/team/repo.git',
      username: 'x-access-token',
      password: 'short-lived-git-password',
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      commitSha: TEST_COMMIT_SHA,
    },
    secrets: { NPM_TOKEN: 'npm-secret-value' },
    jobs: [createJob()],
    ...overrides,
  }
}

/** 构造一次租约。 */
export function createLease(overrides: Partial<PipelineLease> = {}): PipelineLease {
  return {
    leaseId: 'lease-test-1',
    leaseToken: 'lease-token-012345678901234567890123456789',
    expiresAt: new Date(Date.now() + 90_000).toISOString(),
    heartbeatIntervalSeconds: 15,
    run: createRunPlan(),
    ...overrides,
  }
}

/** 记录到的步骤状态上报。 */
export interface RecordedStepStatus {
  stepIndex: number
  body: AgentStepStatusRequest
}

/** 记录到的产物上传；content 是上传时的文件快照。 */
export interface RecordedArtifact extends ArtifactUploadRequest {
  content: Buffer
}

/** 记录型上报接口；供执行器测试断言状态序列与产物内容。 */
export interface RecordingSink {
  sink: RunReportSink
  statuses: RecordedStepStatus[]
  artifacts: RecordedArtifact[]
}

/**
 * 创建记录型 RunReportSink。
 * @returns 可注入执行器的 sink 与记录数组。
 * @remarks 读取产物文件内容到内存，便于断言 tar 与 SHA-256；测试产物应保持较小体积。
 */
export function createRecordingSink(): RecordingSink {
  const statuses: RecordedStepStatus[] = []
  const artifacts: RecordedArtifact[] = []
  return {
    statuses,
    artifacts,
    sink: {
      async reportStepStatus(stepIndex: number, body: AgentStepStatusRequest): Promise<void> {
        statuses.push({ stepIndex, body })
      },
      async uploadArtifact(input: ArtifactUploadRequest): Promise<void> {
        artifacts.push({ ...input, content: await readFile(input.filePath) })
      },
    },
  }
}

/** 记录型日志收集器；把上传的日志分片拼回每个步骤的文本。 */
export interface RecordingCollector {
  collector: ReturnType<typeof createLogCollector>
  texts: Map<number, string>
  batches: AgentLogChunk[][]
}

/**
 * 创建测试用日志收集器。
 * @param options 脱敏器、日志器与可选分片上限。
 * @returns 收集器、按步骤拼接的文本与上传批次记录。
 */
export function createRecordingCollector(options: {
  masker: SecretMasker
  logger: AgentLogger
  chunkMaxBytes?: number
}): RecordingCollector {
  const texts = new Map<number, string>()
  const batches: AgentLogChunk[][] = []
  const collector = createLogCollector({
    masker: options.masker,
    logger: options.logger,
    chunkMaxBytes: options.chunkMaxBytes ?? 16 * 1_024,
    uploadLogs: async (chunks) => {
      batches.push([...chunks])
      for (const chunk of chunks) {
        texts.set(chunk.stepIndex, (texts.get(chunk.stepIndex) ?? '') + chunk.content)
      }
      const acceptedThrough: Record<string, number> = {}
      for (const chunk of chunks) {
        const current = acceptedThrough[String(chunk.stepIndex)]
        acceptedThrough[String(chunk.stepIndex)] = current === undefined ? chunk.seq : Math.max(current, chunk.seq)
      }
      return { acceptedThrough }
    },
  })
  return { collector, texts, batches }
}
