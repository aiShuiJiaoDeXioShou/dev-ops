import assert from 'node:assert/strict'
import { test } from 'node:test'

import { cleanupManagedContainers } from '../src/docker.ts'
import type { DockerRuntime, ManagedContainer } from '../src/docker.ts'
import { createAgentLogger } from '../src/logger.ts'
import { createSecretMasker } from '../src/masking.ts'

interface FakeDockerState {
  containers: ManagedContainer[]
  removed: string[]
  listCalls: number
}

interface FakeDocker extends Pick<DockerRuntime, 'listManagedContainers' | 'removeContainer'> {
  state: FakeDockerState
}

function createFakeDocker(
  initial: readonly ManagedContainer[],
  options: { failIds?: readonly string[]; listError?: Error } = {},
): FakeDocker {
  const state: FakeDockerState = { containers: [...initial], removed: [], listCalls: 0 }
  return {
    state,
    async listManagedContainers(): Promise<ManagedContainer[]> {
      state.listCalls += 1
      if (options.listError) throw options.listError
      return [...state.containers]
    },
    async removeContainer(containerId: string): Promise<void> {
      if (options.failIds?.includes(containerId)) throw new Error(`删除容器失败：${containerId}`)
      state.removed.push(containerId)
      state.containers = state.containers.filter((container) => container.id !== containerId)
    },
  }
}

function createLoggerCapture(): { logger: ReturnType<typeof createAgentLogger>; lines: string[] } {
  const lines: string[] = []
  return { logger: createAgentLogger({ masker: createSecretMasker(), write: (line) => lines.push(line) }), lines }
}

test('启动清理：列出遗留容器、强制删除后再次列举为空', async () => {
  const fakeDocker = createFakeDocker([
    { id: 'container-1', name: 'devops-agent-run-1-build-a', runId: 'run-1' },
    { id: 'container-2', name: 'devops-agent-run-2-build-b', runId: 'run-2' },
  ])
  const { logger, lines } = createLoggerCapture()
  const report = await cleanupManagedContainers(fakeDocker, logger)
  assert.deepEqual(report.failures, [])
  assert.equal(report.removed.length, 2)
  assert.deepEqual(fakeDocker.state.removed.sort(), ['container-1', 'container-2'])
  assert.deepEqual(await fakeDocker.listManagedContainers(), [], '清理后再次列举应为空')
  assert.ok(
    lines.some((line) => line.includes('已清理遗留任务容器')),
    '应记录清理日志',
  )
  assert.ok(
    lines.some((line) => line.includes('启动清理完成')),
    '应记录汇总日志',
  )
})

test('启动清理：单个容器删除失败只告警并继续处理其他容器', async () => {
  const fakeDocker = createFakeDocker(
    [
      { id: 'container-ok', name: 'devops-agent-run-ok-build-a', runId: 'run-ok' },
      { id: 'container-fail', name: 'devops-agent-run-fail-build-b', runId: 'run-fail' },
    ],
    { failIds: ['container-fail'] },
  )
  const { logger, lines } = createLoggerCapture()
  const report = await cleanupManagedContainers(fakeDocker, logger)
  assert.equal(report.removed.length, 1)
  assert.equal(report.failures.length, 1)
  assert.deepEqual(fakeDocker.state.removed, ['container-ok'])
  assert.deepEqual(
    fakeDocker.state.containers.map((container) => container.id),
    ['container-fail'],
    '删除失败的容器保留，等待下次启动重试',
  )
  assert.ok(lines.some((line) => line.includes('WARN') && line.includes('清理遗留任务容器失败')))
})

test('启动清理：列举失败只告警并返回失败清单，不阻塞启动', async () => {
  const fakeDocker = createFakeDocker([], { listError: new Error('docker socket 不可用') })
  const { logger, lines } = createLoggerCapture()
  const report = await cleanupManagedContainers(fakeDocker, logger)
  assert.deepEqual(report.removed, [])
  assert.equal(report.failures.length, 1)
  assert.ok(report.failures[0]?.includes('docker socket 不可用'))
  assert.ok(lines.some((line) => line.includes('列举遗留任务容器失败')))
})

test('按运行标识定向清理只删除目标运行，保留其他运行容器', async () => {
  const fakeDocker = createFakeDocker([
    { id: 'target', name: 'devops-agent-run-target-wait-a', runId: 'run-target' },
    { id: 'keep', name: 'devops-agent-run-keep-wait-b', runId: 'run-keep' },
  ])
  const { logger } = createLoggerCapture()
  const report = await cleanupManagedContainers(fakeDocker, logger, { runId: 'run-target' })
  assert.deepEqual(report.removed, ['devops-agent-run-target-wait-a'])
  assert.deepEqual(fakeDocker.state.removed, ['target'])
  assert.deepEqual(
    fakeDocker.state.containers.map((container) => container.id),
    ['keep'],
    '非目标任务不得被删除',
  )
})
