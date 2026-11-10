import assert from 'node:assert/strict'
import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'

import { createRunStopSignal, executeRunPlan } from '../src/executor.ts'
import { dockerSkipReason } from './helpers/docker.ts'
import {
  checkoutStep,
  countRunContainers,
  createDockerScenario,
  runStep,
  uploadStep,
} from './helpers/executor-docker.ts'
import { createRecordingCollector, createRecordingSink } from './helpers/fixtures.ts'
import { extractTar } from './helpers/tar.ts'

const dockerSkip = await dockerSkipReason()

test('真实 Docker：检出固定提交、串行执行步骤、上传产物并清理容器与工作区', { skip: dockerSkip }, async () => {
  const scenario = await createDockerScenario()
  try {
    const plan = scenario.createPlan([
      checkoutStep(0),
      runStep(1, 'mkdir -p dist && echo artifact-content > dist/out.txt && echo build-ok'),
      runStep(2, 'cat out.txt && echo "ci=$CI foo=$FOO cwd=$(pwd)"', {
        workingDirectory: 'dist',
        env: { FOO: 'bar' },
      }),
      uploadStep(3, 'web-dist', 'dist'),
    ])
    const recording = createRecordingSink()
    const collected = createRecordingCollector({ masker: scenario.masker, logger: scenario.logger })
    const result = await executeRunPlan({
      plan,
      workDir: scenario.workDir,
      docker: scenario.docker,
      sink: recording.sink,
      collector: collected.collector,
      masker: scenario.masker,
      logger: scenario.logger,
      stop: createRunStopSignal(),
      artifactMaxBytes: 64 * 1_024 * 1_024,
    })
    assert.equal(result.status, 'succeeded')
    assert.deepEqual(result.cleanupFailures, [])
    assert.deepEqual(
      recording.statuses.map((item) => [item.stepIndex, item.body.status]),
      [
        [0, 'running'],
        [0, 'succeeded'],
        [1, 'running'],
        [1, 'succeeded'],
        [2, 'running'],
        [2, 'succeeded'],
        [3, 'running'],
        [3, 'succeeded'],
      ],
    )
    const buildLogs = collected.texts.get(1) ?? ''
    assert.ok(buildLogs.includes('build-ok'), '运行步骤输出应被收集')
    const secondLogs = collected.texts.get(2) ?? ''
    assert.ok(secondLogs.includes('artifact-content'), '工作目录应位于 /workspace/dist')
    assert.ok(secondLogs.includes('ci=true'), '运行级 env 应注入')
    assert.ok(secondLogs.includes('foo=bar'), '步骤级 env 应注入')
    assert.ok(secondLogs.includes('/workspace/dist'), 'workingDirectory 应映射到容器工作区')

    assert.equal(recording.artifacts.length, 1, '应上传一个产物')
    const artifact = recording.artifacts[0]
    assert.ok(artifact, '产物记录缺失')
    assert.equal(artifact.name, 'web-dist')
    assert.equal(artifact.stepIndex, 3)
    assert.match(artifact.sha256, /^[0-9a-f]{64}$/)
    const entries = await extractTar(artifact.content)
    const outFile = entries.find((entry) => entry.name === 'out.txt')
    assert.equal(outFile?.content.toString('utf8'), 'artifact-content\n')
    assert.equal(Buffer.byteLength(artifact.content), artifact.sizeBytes)

    assert.equal(await countRunContainers(scenario.runId), 0, '运行结束必须删除容器')
    await assert.rejects(stat(join(scenario.workDir, 'runs', scenario.runId)), '运行结束必须删除工作区')
  } finally {
    await scenario.cleanup()
  }
})

test('真实 Docker：命令失败时步骤失败、退出码可见、后续步骤按 skipped 收口', { skip: dockerSkip }, async () => {
  const scenario = await createDockerScenario()
  try {
    const plan = scenario.createPlan([
      checkoutStep(0),
      runStep(1, 'echo before-failure && exit 3'),
      runStep(2, 'echo never-runs'),
    ])
    const recording = createRecordingSink()
    const collected = createRecordingCollector({ masker: scenario.masker, logger: scenario.logger })
    const result = await executeRunPlan({
      plan,
      workDir: scenario.workDir,
      docker: scenario.docker,
      sink: recording.sink,
      collector: collected.collector,
      masker: scenario.masker,
      logger: scenario.logger,
      stop: createRunStopSignal(),
      artifactMaxBytes: 64 * 1_024 * 1_024,
    })
    assert.equal(result.status, 'failed')
    assert.equal(result.errorCode, 'COMMAND_FAILED')
    const failedStep = recording.statuses.find((item) => item.stepIndex === 1 && item.body.status === 'failed')
    assert.ok(failedStep, '失败步骤应上报 failed')
    assert.equal(failedStep.body.exitCode, 3, '退出码应上报平台')
    assert.ok((collected.texts.get(1) ?? '').includes('before-failure'), '失败前的输出应保留')
    const skippedStep = recording.statuses.find((item) => item.stepIndex === 2 && item.body.status === 'skipped')
    assert.ok(skippedStep, '未执行步骤应上报 skipped')
    assert.equal(await countRunContainers(scenario.runId), 0)
    await assert.rejects(stat(join(scenario.workDir, 'runs', scenario.runId)))
  } finally {
    await scenario.cleanup()
  }
})

test('真实 Docker：continue-on-error 步骤失败后继续执行后续步骤且运行成功', { skip: dockerSkip }, async () => {
  const scenario = await createDockerScenario()
  try {
    const plan = scenario.createPlan([
      checkoutStep(0),
      runStep(1, 'exit 2', { continueOnError: true }),
      runStep(2, 'echo after-continue'),
    ])
    const recording = createRecordingSink()
    const collected = createRecordingCollector({ masker: scenario.masker, logger: scenario.logger })
    const result = await executeRunPlan({
      plan,
      workDir: scenario.workDir,
      docker: scenario.docker,
      sink: recording.sink,
      collector: collected.collector,
      masker: scenario.masker,
      logger: scenario.logger,
      stop: createRunStopSignal(),
      artifactMaxBytes: 64 * 1_024 * 1_024,
    })
    assert.equal(result.status, 'succeeded')
    const failedStep = recording.statuses.find((item) => item.stepIndex === 1 && item.body.status === 'failed')
    assert.ok(failedStep, 'continue-on-error 步骤仍上报 failed')
    assert.equal(failedStep.body.exitCode, 2)
    const laterStep = recording.statuses.find((item) => item.stepIndex === 2 && item.body.status === 'succeeded')
    assert.ok(laterStep, '后续步骤应继续执行')
    assert.ok((collected.texts.get(2) ?? '').includes('after-continue'))
  } finally {
    await scenario.cleanup()
  }
})
