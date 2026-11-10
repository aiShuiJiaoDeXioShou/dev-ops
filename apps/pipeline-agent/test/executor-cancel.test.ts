import assert from 'node:assert/strict'
import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'

import { createRunStopSignal, executeRunPlan } from '../src/executor.ts'
import { dockerSkipReason } from './helpers/docker.ts'
import { checkoutStep, countRunContainers, createDockerScenario, runStep } from './helpers/executor-docker.ts'
import { createRecordingCollector, createRecordingSink } from './helpers/fixtures.ts'
import type { RecordingSink } from './helpers/fixtures.ts'

const dockerSkip = await dockerSkipReason()

async function waitForRunningStep(recording: RecordingSink, stepIndex: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (recording.statuses.some((item) => item.stepIndex === stepIndex && item.body.status === 'running')) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`等待步骤 ${String(stepIndex)} 进入 running 超时`)
}

async function assertResourcesCleaned(workDir: string, runId: string): Promise<void> {
  assert.equal(await countRunContainers(runId), 0, '取消/超时后必须删除容器')
  await assert.rejects(stat(join(workDir, 'runs', runId)), '取消/超时后必须删除工作区')
}

test('真实 Docker：取消正在执行的步骤会终止容器并上报 cancelled', { skip: dockerSkip }, async () => {
  const scenario = await createDockerScenario()
  try {
    const plan = scenario.createPlan([checkoutStep(0), runStep(1, 'sleep 20', { timeoutSeconds: 120 })])
    const recording = createRecordingSink()
    const collected = createRecordingCollector({ masker: scenario.masker, logger: scenario.logger })
    const stop = createRunStopSignal()
    const startedAt = Date.now()
    const execution = executeRunPlan({
      plan,
      workDir: scenario.workDir,
      docker: scenario.docker,
      sink: recording.sink,
      collector: collected.collector,
      masker: scenario.masker,
      logger: scenario.logger,
      stop,
      artifactMaxBytes: 64 * 1_024 * 1_024,
    })
    await waitForRunningStep(recording, 1, 30_000)
    stop.stop('cancelled')
    const result = await execution
    assert.equal(result.status, 'cancelled')
    assert.ok(Date.now() - startedAt < 20_000, '取消应立即停止执行，而不是等待命令自然结束')
    assert.ok(
      recording.statuses.some((item) => item.stepIndex === 1 && item.body.status === 'cancelled'),
      '运行中的步骤应上报 cancelled',
    )
    await assertResourcesCleaned(scenario.workDir, scenario.runId)
  } finally {
    await scenario.cleanup()
  }
})

test('真实 Docker：步骤超时终止容器并上报 failed/STEP_TIMEOUT', { skip: dockerSkip }, async () => {
  const scenario = await createDockerScenario()
  try {
    const plan = scenario.createPlan([checkoutStep(0), runStep(1, 'sleep 10', { timeoutSeconds: 1 })])
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
    assert.equal(result.errorCode, 'STEP_TIMEOUT')
    const failedStep = recording.statuses.find((item) => item.stepIndex === 1 && item.body.status === 'failed')
    assert.ok(failedStep, '超时步骤应上报 failed')
    assert.equal(failedStep.body.errorCode, 'STEP_TIMEOUT')
    await assertResourcesCleaned(scenario.workDir, scenario.runId)
  } finally {
    await scenario.cleanup()
  }
})

test('真实 Docker：运行级超时优先于步骤超时并以 RUN_TIMEOUT 收口', { skip: dockerSkip }, async () => {
  const scenario = await createDockerScenario()
  try {
    // 运行级超时需明显大于检出与容器启动耗时，避免并行负载下把检出误判成超时前置失败；
    // 仍远小于步骤 60s，保证“运行级超时优先于步骤超时”的断言有效。
    const plan = scenario.createPlan([checkoutStep(0), runStep(1, 'sleep 20', { timeoutSeconds: 60 })], {
      timeoutSeconds: 10,
    })
    const recording = createRecordingSink()
    const collected = createRecordingCollector({ masker: scenario.masker, logger: scenario.logger })
    const startedAt = Date.now()
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
    assert.equal(result.errorCode, 'RUN_TIMEOUT')
    assert.ok(Date.now() - startedAt < 30_000, '运行级超时应终止长时间步骤')
    const failedStep = recording.statuses.find((item) => item.stepIndex === 1 && item.body.status === 'failed')
    assert.equal(failedStep?.body.errorCode, 'RUN_TIMEOUT')
    await assertResourcesCleaned(scenario.workDir, scenario.runId)
  } finally {
    await scenario.cleanup()
  }
})
