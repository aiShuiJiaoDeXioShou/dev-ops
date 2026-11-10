import assert from 'node:assert/strict'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import type { RunPlanStep } from '@dev-ops/pipeline-protocol'

import { AsyncTimeoutError } from '../src/async.ts'
import { createDockerRuntime } from '../src/docker.ts'
import type { ContainerExecInput, DockerRuntime, JobContainer } from '../src/docker.ts'
import { createRunStopSignal, executeRunPlan } from '../src/executor.ts'
import { createAgentLogger } from '../src/logger.ts'
import { createSecretMasker } from '../src/masking.ts'
import { checkoutStep, runStep } from './helpers/executor-docker.ts'
import { createRecordingCollector, createRecordingSink, createRunPlan, TEST_COMMIT_SHA } from './helpers/fixtures.ts'
import { createTestGitRepo } from './helpers/git-repo.ts'
import type { TestGitRepo } from './helpers/git-repo.ts'
import type { RunWorkspace } from '../src/workspace.ts'

/** 假的 exec 记录；用于断言环境合并与工作目录映射。 */
interface FakeExecRecord {
  script: string
  env: Record<string, string>
  workingDirectory: string
}

interface FakeDocker extends DockerRuntime {
  execRecords: FakeExecRecord[]
  removedContainers: number
  images: string[]
}

function createFakeDocker(options: { createError?: Error } = {}): FakeDocker {
  const execRecords: FakeExecRecord[] = []
  const images: string[] = []
  const state = { removedContainers: 0 }
  return {
    execRecords,
    images,
    get removedContainers(): number {
      return state.removedContainers
    },
    async ping(): Promise<void> {
      return undefined
    },
    async ensureImage(image: string): Promise<void> {
      images.push(image)
    },
    async createJobContainer(input): Promise<JobContainer> {
      if (options.createError) throw options.createError
      const container: JobContainer = {
        id: `fake-container-${String(images.length)}-${input.jobId}`,
        async exec(args: ContainerExecInput) {
          execRecords.push({ script: args.script, env: { ...args.env }, workingDirectory: args.workingDirectory })
          args.onOutput('fake-output\n')
          return { exitCode: 0, timedOut: false, cancelled: false }
        },
        async remove(): Promise<void> {
          state.removedContainers += 1
        },
      }
      return container
    },
  }
}

interface ExecutorScenario {
  workDir: string
  repo: TestGitRepo
  runId: string
  cleanup(): Promise<void>
}

async function createScenario(): Promise<ExecutorScenario> {
  const workDir = await mkdtemp(join(tmpdir(), 'devops-agent-executor-unit-'))
  const repo = await createTestGitRepo()
  const runId = 'run-unit-1'
  return {
    workDir,
    repo,
    runId,
    async cleanup(): Promise<void> {
      await repo.cleanup()
      await rm(workDir, { recursive: true, force: true })
    },
  }
}

function planFor(scenario: ExecutorScenario, steps: readonly RunPlanStep[], maxBytes = 64 * 1_024 * 1_024) {
  const plan = createRunPlan({
    runId: scenario.runId,
    timeoutSeconds: 120,
    commitSha: scenario.repo.commitSha,
    git: {
      remoteUrl: scenario.repo.remoteUrl,
      username: 'x-access-token',
      password: 'local-credential-value',
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      commitSha: scenario.repo.commitSha,
    },
    jobs: [
      {
        id: 'build',
        name: '构建',
        image: 'fake-image:1',
        runsOn: ['linux'],
        timeoutSeconds: 120,
        env: {},
        steps: [...steps],
      },
    ],
  })
  return { plan, maxBytes }
}

test('执行器：检出、步骤执行与产物打包走同一工作区，结束后清理容器与工作区', async () => {
  const scenario = await createScenario()
  const fakeDocker = createFakeDocker()
  const masker = createSecretMasker()
  const logger = createAgentLogger({ masker, write: () => undefined })
  try {
    const { plan, maxBytes } = planFor(scenario, [
      checkoutStep(0),
      runStep(1, 'echo unit-test', { env: { STEP_ENV: 'step-value' } }),
      { index: 2, name: '上传仓库内容', kind: 'builtin_upload_artifact', with: { name: 'repo-bundle', path: '.' } },
    ])
    const recording = createRecordingSink()
    const collected = createRecordingCollector({ masker, logger })
    const result = await executeRunPlan({
      plan,
      workDir: scenario.workDir,
      docker: fakeDocker,
      sink: recording.sink,
      collector: collected.collector,
      masker,
      logger,
      stop: createRunStopSignal(),
      artifactMaxBytes: maxBytes,
    })
    assert.equal(result.status, 'succeeded')
    assert.equal(result.cleanupFailures.length, 0)
    assert.equal(fakeDocker.removedContainers, 1, 'job 容器必须被删除')
    assert.deepEqual(
      recording.statuses.map((item) => [item.stepIndex, item.body.status]),
      [
        [0, 'running'],
        [0, 'succeeded'],
        [1, 'running'],
        [1, 'succeeded'],
        [2, 'running'],
        [2, 'succeeded'],
      ],
    )
    assert.equal(fakeDocker.execRecords.length, 1)
    const exec = fakeDocker.execRecords[0]
    assert.ok(exec, '应有 run 步骤执行记录')
    assert.equal(exec.script, 'echo unit-test')
    assert.equal(exec.workingDirectory, '/workspace')
    assert.equal(exec.env.CI, 'true', '运行级 env 应合并')
    assert.equal(exec.env.STEP_ENV, 'step-value', '步骤级 env 应合并')
    assert.ok((collected.texts.get(1) ?? '').includes('fake-output'))
    assert.equal(recording.artifacts.length, 1)
    const artifact = recording.artifacts[0]
    assert.ok(artifact)
    assert.equal(artifact.name, 'repo-bundle')
    await assert.rejects(stat(join(scenario.workDir, 'runs', scenario.runId)))
  } finally {
    await scenario.cleanup()
  }
})

test('执行器：产物路径不存在时步骤失败，未执行步骤按 skipped 收口', async () => {
  const scenario = await createScenario()
  const fakeDocker = createFakeDocker()
  const masker = createSecretMasker()
  const logger = createAgentLogger({ masker, write: () => undefined })
  try {
    const { plan, maxBytes } = planFor(scenario, [
      checkoutStep(0),
      {
        index: 1,
        name: '缺失产物',
        kind: 'builtin_upload_artifact',
        with: { name: 'missing', path: 'does-not-exist' },
      },
      runStep(2, 'echo never-runs'),
    ])
    const recording = createRecordingSink()
    const collected = createRecordingCollector({ masker, logger })
    const result = await executeRunPlan({
      plan,
      workDir: scenario.workDir,
      docker: fakeDocker,
      sink: recording.sink,
      collector: collected.collector,
      masker,
      logger,
      stop: createRunStopSignal(),
      artifactMaxBytes: maxBytes,
    })
    assert.equal(result.status, 'failed')
    assert.equal(result.errorCode, 'ARTIFACT_PATH_NOT_FOUND')
    assert.equal(recording.artifacts.length, 0, '路径缺失时不得生成空产物')
    const failed = recording.statuses.find((item) => item.stepIndex === 1 && item.body.status === 'failed')
    assert.equal(failed?.body.errorCode, 'ARTIFACT_PATH_NOT_FOUND')
    assert.ok(recording.statuses.some((item) => item.stepIndex === 2 && item.body.status === 'skipped'))
    assert.equal(fakeDocker.removedContainers, 1)
  } finally {
    await scenario.cleanup()
  }
})

test('执行器：产物超过大小上限时步骤失败，不上传不完整产物', async () => {
  const scenario = await createScenario()
  const fakeDocker = createFakeDocker()
  const masker = createSecretMasker()
  const logger = createAgentLogger({ masker, write: () => undefined })
  try {
    const { plan } = planFor(
      scenario,
      [
        checkoutStep(0),
        { index: 1, name: '超限产物', kind: 'builtin_upload_artifact', with: { name: 'huge', path: '.' } },
      ],
      50,
    )
    const recording = createRecordingSink()
    const collected = createRecordingCollector({ masker, logger })
    const result = await executeRunPlan({
      plan,
      workDir: scenario.workDir,
      docker: fakeDocker,
      sink: recording.sink,
      collector: collected.collector,
      masker,
      logger,
      stop: createRunStopSignal(),
      artifactMaxBytes: 50,
    })
    assert.equal(result.status, 'failed')
    assert.equal(result.errorCode, 'ARTIFACT_LIMIT_EXCEEDED')
    assert.equal(recording.artifacts.length, 0)
  } finally {
    await scenario.cleanup()
  }
})

test('执行器：步骤工作目录逃逸或环境变量非法时显式失败', async () => {
  const scenario = await createScenario()
  const fakeDocker = createFakeDocker()
  const masker = createSecretMasker()
  const logger = createAgentLogger({ masker, write: () => undefined })
  try {
    const { plan, maxBytes } = planFor(scenario, [
      checkoutStep(0),
      runStep(1, 'echo escape', { workingDirectory: '../outside' }),
      runStep(2, 'echo bad-env', { env: { 'BAD-NAME': 'value' } }),
    ])
    const recording = createRecordingSink()
    const collected = createRecordingCollector({ masker, logger })
    const result = await executeRunPlan({
      plan,
      workDir: scenario.workDir,
      docker: fakeDocker,
      sink: recording.sink,
      collector: collected.collector,
      masker,
      logger,
      stop: createRunStopSignal(),
      artifactMaxBytes: maxBytes,
    })
    assert.equal(result.status, 'failed')
    assert.equal(result.errorCode, 'INVALID_WORKING_DIRECTORY')
    assert.equal(fakeDocker.execRecords.length, 0, '参数非法时不得在容器内执行命令')
  } finally {
    await scenario.cleanup()
  }
})

test('执行器：容器创建失败时显式失败并清理', async () => {
  const scenario = await createScenario()
  const fakeDocker = createFakeDocker({ createError: new Error('镜像不可用') })
  const masker = createSecretMasker()
  const logger = createAgentLogger({ masker, write: () => undefined })
  try {
    const { plan, maxBytes } = planFor(scenario, [runStep(0, 'echo hello')])
    const recording = createRecordingSink()
    const collected = createRecordingCollector({ masker, logger })
    const result = await executeRunPlan({
      plan,
      workDir: scenario.workDir,
      docker: fakeDocker,
      sink: recording.sink,
      collector: collected.collector,
      masker,
      logger,
      stop: createRunStopSignal(),
      artifactMaxBytes: maxBytes,
    })
    assert.equal(result.status, 'failed')
    assert.equal(result.errorCode, 'AGENT_EXECUTION_FAILED')
    assert.ok(result.errorMessage?.includes('镜像不可用'))
  } finally {
    await scenario.cleanup()
  }
})

test('执行器：真实 docker 运行时创建失败于 ping 时由 daemon 启动校验捕获', async () => {
  // 这里只验证 createDockerRuntime 会立即推导容器用户，不启动真实 Docker；
  // 真实 Docker 路径由 executor.docker.test.ts 覆盖。
  const runtime = createDockerRuntime({
    socketPath: '/nonexistent/docker.sock',
    limits: { cpus: 1, memoryBytes: 256 * 1_024 * 1_024, pidsLimit: 128 },
    logger: createAgentLogger({ masker: createSecretMasker(), write: () => undefined }),
  })
  await assert.rejects(() => runtime.ping())
})

/** 最小假工作区；只替换 ensureCheckout 以构造超时分类场景。 */
function createFakeWorkspace(ensureCheckout: () => Promise<void>): RunWorkspace {
  let checkedOutCommit: string | undefined
  return {
    rootDir: '/tmp/devops-agent-fake-run',
    checkoutDir: '/tmp/devops-agent-fake-run/repository',
    tempDir: '/tmp/devops-agent-fake-run/tmp',
    get checkedOutCommit(): string | undefined {
      return checkedOutCommit
    },
    async ensureCheckout(): Promise<void> {
      await ensureCheckout()
      checkedOutCommit = TEST_COMMIT_SHA
    },
    async remove(): Promise<void> {
      return undefined
    },
  }
}

test('执行器：代码检出被运行级超时中断时按 RUN_TIMEOUT 收口', async () => {
  const scenario = await createScenario()
  const fakeDocker = createFakeDocker()
  const masker = createSecretMasker()
  const logger = createAgentLogger({ masker, write: () => undefined })
  try {
    const { plan, maxBytes } = planFor(scenario, [checkoutStep(0)])
    const recording = createRecordingSink()
    const collected = createRecordingCollector({ masker, logger })
    const workspace = createFakeWorkspace(async () => {
      throw new AsyncTimeoutError('git 检出超过运行级超时')
    })
    const result = await executeRunPlan({
      plan,
      workDir: scenario.workDir,
      docker: fakeDocker,
      sink: recording.sink,
      collector: collected.collector,
      masker,
      logger,
      stop: createRunStopSignal(),
      artifactMaxBytes: maxBytes,
      createWorkspace: async () => workspace,
    })
    assert.equal(result.status, 'failed')
    assert.equal(result.errorCode, 'RUN_TIMEOUT')
    const failed = recording.statuses.find((item) => item.stepIndex === 0 && item.body.status === 'failed')
    assert.equal(failed?.body.errorCode, 'RUN_TIMEOUT', '检出被运行超时中断不得误报 GIT_CHECKOUT_FAILED')
  } finally {
    await scenario.cleanup()
  }
})

test('执行器：代码检出跨过运行截止时间时即使成功也按 RUN_TIMEOUT 收口', async () => {
  const scenario = await createScenario()
  const fakeDocker = createFakeDocker()
  const masker = createSecretMasker()
  const logger = createAgentLogger({ masker, write: () => undefined })
  try {
    const { plan, maxBytes } = planFor(scenario, [checkoutStep(0)], 64 * 1_024 * 1_024)
    const startedPlan = { ...plan, timeoutSeconds: 1 }
    const recording = createRecordingSink()
    const collected = createRecordingCollector({ masker, logger })
    const workspace = createFakeWorkspace(async () => {
      // 等待超过从 startedAt 推导出的剩余时间（约 100ms），模拟检出跨过运行截止。
      await new Promise((resolve) => setTimeout(resolve, 250))
    })
    const result = await executeRunPlan({
      plan: startedPlan,
      workDir: scenario.workDir,
      docker: fakeDocker,
      sink: recording.sink,
      collector: collected.collector,
      masker,
      logger,
      stop: createRunStopSignal(),
      artifactMaxBytes: maxBytes,
      startedAt: Date.now() - 900,
      createWorkspace: async () => workspace,
    })
    assert.equal(result.status, 'failed')
    assert.equal(result.errorCode, 'RUN_TIMEOUT')
    const failed = recording.statuses.find((item) => item.stepIndex === 0 && item.body.status === 'failed')
    assert.equal(failed?.body.errorCode, 'RUN_TIMEOUT')
  } finally {
    await scenario.cleanup()
  }
})
