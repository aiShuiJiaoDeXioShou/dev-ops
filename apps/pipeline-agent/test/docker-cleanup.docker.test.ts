import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'

import Docker from 'dockerode'

import {
  cleanupManagedContainers,
  createDockerRuntime,
  JOB_ID_CONTAINER_LABEL,
  MANAGED_CONTAINER_LABEL,
  RUN_ID_CONTAINER_LABEL,
} from '../src/docker.ts'
import { createAgentLogger } from '../src/logger.ts'
import { createSecretMasker } from '../src/masking.ts'
import { dockerSkipReason, TEST_IMAGE } from './helpers/docker.ts'

const dockerSkip = await dockerSkipReason()

test('真实 Docker：启动清理按运行标识强制删除遗留任务容器', { skip: dockerSkip }, async () => {
  const rawDocker = new Docker()
  const masker = createSecretMasker()
  const lines: string[] = []
  const logger = createAgentLogger({ masker, write: (line) => lines.push(line) })
  const runtime = createDockerRuntime({
    limits: { cpus: 1, memoryBytes: 256 * 1_024 * 1_024, pidsLimit: 128 },
    pullTimeoutMs: 300_000,
    logger,
  })
  await runtime.ping()
  await runtime.ensureImage(TEST_IMAGE)

  // 定向运行标识隔离测试容器：不影响宿主机上其他带 managed 标签的容器（例如待复验的真实孤儿）。
  const runId = `orphan-test-${randomUUID().slice(0, 8)}`
  const container = await rawDocker.createContainer({
    Image: TEST_IMAGE,
    Cmd: ['sh', '-c', 'sleep 300'],
    Labels: {
      [MANAGED_CONTAINER_LABEL]: 'true',
      [RUN_ID_CONTAINER_LABEL]: runId,
      [JOB_ID_CONTAINER_LABEL]: 'wait',
    },
  })
  try {
    await container.start()
    const before = await runtime.listManagedContainers()
    assert.ok(
      before.some((item) => item.id === container.id && item.runId === runId),
      '按 managed 标签应能列举到测试容器',
    )

    const report = await cleanupManagedContainers(runtime, logger, { runId })
    assert.deepEqual(report.failures, [])
    assert.equal(report.removed.length, 1)

    const after = await runtime.listManagedContainers()
    assert.ok(!after.some((item) => item.id === container.id), '清理后容器不应再被列举')
    await assert.rejects(() => container.inspect(), '清理后容器 inspect 应失败（已删除）')
    assert.ok(
      lines.some((line) => line.includes('已清理遗留任务容器')),
      '应记录清理日志',
    )
  } finally {
    await rawDocker
      .getContainer(container.id)
      .remove({ force: true })
      .catch(() => undefined)
  }
})
