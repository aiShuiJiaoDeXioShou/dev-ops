import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import type { PipelineStepStatus, RunPlan } from '@dev-ops/pipeline-protocol'
import { createRunStopSignal } from '../src/executor.ts'
import { executeNativeDeployment } from '../src/native-deploy.ts'

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
  const execute = (run: RunPlan) =>
    executeNativeDeployment({
      plan: run,
      host: { script, repository, workflow },
      stop: createRunStopSignal(),
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
