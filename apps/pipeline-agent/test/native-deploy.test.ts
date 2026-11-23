import assert from 'node:assert/strict'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import type { PipelineStepStatus, RunPlan } from '@dev-ops/pipeline-protocol'
import { createRunStopSignal } from '../src/executor.ts'
import { executeHostCommand } from '../src/host-command.ts'
import { createAgentLogger } from '../src/logger.ts'
import { createSecretMasker } from '../src/masking.ts'
import { executeNativeDeployment } from '../src/native-deploy.ts'
import { createRecordingCollector, createRecordingSink, createRunPlan } from './helpers/fixtures.ts'
import { createTestGitRepo } from './helpers/git-repo.ts'

test('原生发布执行宿主脚本、记录日志和终态，拒绝不同仓库及分支', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'devops-native-deploy-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const script = join(directory, 'release.sh')
  await writeFile(script, 'printf "版本=%s\\n" "$1"\n')
  const repository = 'https://github.com/example/dev-ops.git'
  const workflow = '.devops/workflows/deploy-macmini.yml'
  const commitSha = '1'.repeat(40)
  const plan: RunPlan = {
    runId: 'test-run',
    workflowPath: workflow,
    workflowName: 'Mac mini',
    ref: 'main',
    commitSha,
    timeoutSeconds: 60,
    inputs: {},
    env: {},
    secrets: {},
    git: { remoteUrl: repository, username: 'test', password: 'test', expiresAt: '2026-11-21T00:00:00Z', commitSha },
    jobs: [
      {
        id: 'deploy',
        name: '发布',
        image: 'macmini-native',
        runsOn: ['macmini-deploy'],
        timeoutSeconds: 60,
        steps: [{ index: 0, name: '原生发布', kind: 'builtin_deploy_native' }],
      },
    ],
  }
  const status: PipelineStepStatus[] = []
  const logs: string[] = []
  const masker = createSecretMasker()
  const execute = (run: RunPlan) =>
    executeNativeDeployment({
      plan: run,
      host: { script, repository, workflow },
      stop: createRunStopSignal(),
      workDir: directory,
      masker,
      logger: createAgentLogger({ masker, write: () => undefined }),
      artifactMaxBytes: 1_024,
      sink: {
        async reportStepStatus(_index, body) {
          status.push(body.status)
        },
        async uploadArtifact() {
          assert.fail('原生发布不上传产物')
        },
      },
      collector: {
        append(_index, chunk) {
          logs.push(chunk)
        },
        async flush() {},
        isTruncated: () => false,
      },
    })
  assert.equal((await execute({ ...plan, ref: 'feature' })).status, 'failed')
  assert.equal(
    (await execute({ ...plan, git: { ...plan.git, remoteUrl: 'https://example.test/other.git' } })).status,
    'failed',
  )
  assert.deepEqual(status, [])
  assert.equal((await execute(plan)).status, 'succeeded')
  assert.deepEqual(status, ['running', 'succeeded'])
  assert.equal(logs.join(''), `版本=${commitSha}\n`)
})

test('原生作业在宿主工作区检出固定提交并执行 run，且不把检出令牌交给命令', async (t) => {
  const repo = await createTestGitRepo()
  t.after(() => repo.cleanup())
  const workDir = await mkdtemp(join(tmpdir(), 'devops-native-workspace-'))
  t.after(() => rm(workDir, { recursive: true, force: true }))
  const workflow = '.devops/workflows/deploy-macmini.yml'
  const plan = createRunPlan({
    workflowPath: workflow,
    ref: 'main',
    commitSha: repo.commitSha,
    git: {
      remoteUrl: repo.remoteUrl,
      username: 'test',
      password: 'private-checkout-token',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      commitSha: repo.commitSha,
    },
    jobs: [
      {
        id: 'mac',
        name: '原生作业',
        image: 'macmini-native',
        runsOn: ['macmini-deploy'],
        timeoutSeconds: 60,
        steps: [
          { index: 0, name: '检出', kind: 'builtin_checkout', with: { submodules: 'true' } },
          {
            index: 1,
            name: '执行脚本',
            kind: 'run',
            run: 'test -z "${DEVOPS_DEPLOY_GIT_TOKEN:-}${GIT_CONFIG_VALUE_0:-}"; cat app.txt; printf "\\n%s\\n" "$TEST_MESSAGE"',
            env: { TEST_MESSAGE: '原生执行完成' },
          },
        ],
      },
    ],
  })
  const { sink, statuses } = createRecordingSink()
  const masker = createSecretMasker()
  const logger = createAgentLogger({ masker, write: () => undefined })
  const { collector, texts } = createRecordingCollector({ masker, logger })
  const result = await executeNativeDeployment({
    plan,
    host: { repository: repo.remoteUrl, workflow },
    workDir,
    stop: createRunStopSignal(),
    sink,
    collector,
    masker,
    logger,
    artifactMaxBytes: 1_024,
  })
  assert.equal(result.status, 'succeeded', result.errorMessage)
  assert.deepEqual(
    statuses.map(({ body }) => body.status),
    ['running', 'succeeded', 'running', 'succeeded'],
  )
  assert.ok(texts.get(1)?.includes(repo.firstContent))
  assert.ok(texts.get(1)?.includes('原生执行完成'))
  assert.deepEqual(await readdir(join(workDir, 'runs')), [])
})

test('宿主步骤超时后等待脚本处理 TERM', async () => {
  const lines: string[] = []
  const result = await executeHostCommand({
    args: ['-c', `trap 'echo 收尾完成; exit 143' TERM; sleep 15`],
    env: { PATH: '/usr/bin:/bin' },
    timeoutMs: 350,
    signal: new AbortController().signal,
    onOutput: (line) => lines.push(line),
  })
  assert.deepEqual(result, { exitCode: 143, timedOut: true, cancelled: false })
  assert.match(lines.join(''), /收尾完成/)
})
