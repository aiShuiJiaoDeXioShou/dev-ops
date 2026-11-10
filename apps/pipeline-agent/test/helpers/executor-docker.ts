import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import Docker from 'dockerode'

import type { RunPlan, RunPlanStep } from '@dev-ops/pipeline-protocol'

import { createDockerRuntime } from '../../src/docker.ts'
import type { DockerRuntime } from '../../src/docker.ts'
import { createAgentLogger } from '../../src/logger.ts'
import type { AgentLogger } from '../../src/logger.ts'
import { createSecretMasker } from '../../src/masking.ts'
import type { SecretMasker } from '../../src/masking.ts'
import { TEST_IMAGE } from './docker.ts'
import { createJob, createRunPlan } from './fixtures.ts'
import { createTestGitRepo } from './git-repo.ts'
import type { TestGitRepo } from './git-repo.ts'

/** 真实 Docker 执行器测试场景；所有资源由 cleanup 统一回收。 */
export interface DockerScenario {
  workDir: string
  runId: string
  repo: TestGitRepo
  docker: DockerRuntime
  logger: AgentLogger
  masker: SecretMasker
  /** 构建设置了本地 Git 远端的运行计划。 */
  createPlan(steps: readonly RunPlanStep[], overrides?: Partial<RunPlan>): RunPlan
  /** 清理工作目录与测试仓库；执行器应已清理运行工作区。 */
  cleanup(): Promise<void>
}

/**
 * 创建真实 Docker 执行器测试场景。
 * @returns 临时工作目录、本地 Git 仓库、docker 运行时、日志与计划构造器。
 */
export async function createDockerScenario(): Promise<DockerScenario> {
  const workDir = await mkdtemp(join(tmpdir(), 'devops-agent-executor-'))
  const repo = await createTestGitRepo()
  const runId = `run-docker-${randomUUID().slice(0, 8)}`
  const masker = createSecretMasker()
  const lines: string[] = []
  const logger = createAgentLogger({ masker, write: (line) => lines.push(line) })
  const docker = createDockerRuntime({
    limits: { cpus: 1, memoryBytes: 512 * 1_024 * 1_024, pidsLimit: 256 },
    pullTimeoutMs: 300_000,
    logger,
  })
  await docker.ping()
  await docker.ensureImage(TEST_IMAGE)
  return {
    workDir,
    runId,
    repo,
    docker,
    logger,
    masker,
    createPlan(steps: readonly RunPlanStep[], overrides: Partial<RunPlan> = {}): RunPlan {
      return createRunPlan({
        runId,
        timeoutSeconds: 120,
        commitSha: repo.commitSha,
        git: {
          remoteUrl: repo.remoteUrl,
          username: 'x-access-token',
          password: 'short-lived-local-credential',
          expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
          commitSha: repo.commitSha,
        },
        jobs: [createJob({ image: TEST_IMAGE, timeoutSeconds: 120, steps: [...steps] })],
        ...overrides,
      })
    },
    async cleanup(): Promise<void> {
      await repo.cleanup()
      await rm(workDir, { recursive: true, force: true })
    },
  }
}

/** 标准检出步骤；所有真实执行场景都以它开始。 */
export function checkoutStep(index = 0): RunPlanStep {
  return { index, name: 'Checkout', kind: 'builtin_checkout', with: { 'fetch-depth': '1' } }
}

/** 构造 run 步骤。 */
export function runStep(index: number, run: string, overrides: Partial<RunPlanStep> = {}): RunPlanStep {
  return {
    index,
    name: `Run ${String(index)}`,
    kind: 'run',
    run,
    workingDirectory: '.',
    env: {},
    timeoutSeconds: 60,
    ...overrides,
  }
}

/** 构造产物上传步骤。 */
export function uploadStep(index: number, name: string, path: string): RunPlanStep {
  return { index, name: `Upload ${name}`, kind: 'builtin_upload_artifact', with: { name, path } }
}

/**
 * 统计某运行标识关联的 Docker 容器数量（含已停止）。
 * @param runId 运行标识；执行器会打上 `devops.agent.run-id` 标签。
 * @returns 容器数量；执行结束清理后应为 0。
 */
export async function countRunContainers(runId: string): Promise<number> {
  const docker = new Docker()
  const containers = await docker.listContainers({
    all: true,
    filters: { label: [`devops.agent.run-id=${runId}`] },
  })
  return containers.length
}
