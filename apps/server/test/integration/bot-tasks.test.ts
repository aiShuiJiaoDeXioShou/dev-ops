import assert from 'node:assert/strict'
import { test } from 'node:test'
import { eq, sql } from 'drizzle-orm'
import { createHttpApp } from '../../src/bootstrap/create-http-app.ts'
import {
  claimBotRun,
  finishBotRun,
  reconcileExpiredBotRuns,
  renewBotRunLease,
} from '../../src/modules/bots/bots.run-queue.repository.ts'
import { botRun } from '../../src/modules/bots/bots.tables.ts'
import { createBotTestDatabase } from '../support/bot-database.ts'
import { seedBotWorkflowFixture } from '../support/bot-workflow-fixtures.ts'

test('任务保存输入版本，排队停止和中断后可以重新运行，取消后保持终态', async (t) => {
  const { db, config, cleanup } = await createBotTestDatabase(t)
  const app = createHttpApp({ ...config, GIT_CREDENTIAL_ENCRYPTION_KEY: Buffer.alloc(32, 28).toString('base64') })
  cleanup.push(() => app.close())
  const { devUser, viewerUser, botId, roomPath, get, post } = await seedBotWorkflowFixture(app)
  const taskInput = { title: '核对交付', businessOwnerId: devUser.userId, acceptanceCriteria: '列出交付证据' }
  assert.equal((await post(`${roomPath}/tasks`, taskInput, viewerUser)).code, 'BOT_CONVERSATION_NOT_FOUND')
  const create = await post(`${roomPath}/tasks`, taskInput)
  assert.equal(create.code, 'OK', create.message)
  const { task, runId } = create.data
  assert.equal(task.executorBotId, botId)
  assert.equal(task.status, 'pending')
  assert.equal(create.data.runStatus, 'queued')
  const taskPath = `/bot-tasks/${task.id}`
  assert.equal((await get(taskPath)).data.runs.length, 1)
  const queueStop = await post(`/bot-runs/${runId}/stop`, {})
  assert.equal(queueStop.data.status, 'stopped', queueStop.message)
  let current = (await get(taskPath)).data
  assert.equal(current.status, 'waiting')
  assert.equal(current.waitReason, 'stopped')

  const amendments = await Promise.all([
    post(`${taskPath}/append`, { version: current.version, content: '检查第一条验收条件' }),
    post(`${taskPath}/append`, { version: current.version, content: '检查第二条验收条件' }),
  ])
  assert.deepEqual(amendments.map((result) => result.code).sort(), ['OK', 'VERSION_CONFLICT'])
  current = (await get(taskPath)).data
  assert.equal(current.inputVersion, 2)
  assert.equal(current.inputs.length, 2)
  const rerun = await post(`${taskPath}/rerun`, { version: current.version })
  assert.equal(rerun.code, 'OK', rerun.message)
  assert.notEqual(rerun.data.runId, runId)

  const limits = { global: 3, perTeam: 2, ttlSeconds: 30 }
  const running = await claimBotRun(db, 'task-test', limits)
  assert.ok(running)
  assert.equal(running.id, rerun.data.runId)
  const stop = await post(`/bot-runs/${running.id}/stop`, {})
  assert.equal(stop.data.status, 'running')
  assert.equal(stop.data.stopRequested, true)
  const lease = { id: running.id, epoch: running.lease_epoch, owner: 'task-test' }
  assert.deepEqual(await renewBotRunLease(db, lease, 30), { stopRequested: true })
  const finished = await db.transaction((tx) => finishBotRun(tx, lease, { status: 'succeeded' }))
  assert.equal(finished?.status, 'stopped')
  current = (await get(taskPath)).data
  assert.equal(current.waitReason, 'stopped')
  assert.equal((await post(`${taskPath}/rerun`, { version: current.version })).code, 'OK')

  const interrupted = await claimBotRun(db, 'task-test', limits)
  assert.ok(interrupted)
  await db
    .update(botRun)
    .set({ lease_until: sql`clock_timestamp() - interval '1 second'` })
    .where(eq(botRun.id, interrupted.id))
  assert.equal(await reconcileExpiredBotRuns(db), 1)
  current = (await get(taskPath)).data
  assert.equal(current.status, 'waiting')
  assert.equal(current.runs[0].failureKind, 'execution_interrupted')
  assert.equal(current.runs.length, 3)
  const cancelled = await post(`${taskPath}/cancel`, { version: current.version })
  assert.equal(cancelled.data.status, 'cancelled')
  assert.equal((await post(`${taskPath}/rerun`, { version: cancelled.data.version })).code, 'BOT_TASK_STATE_CONFLICT')
  assert.equal((await get(`${roomPath}/tasks`)).data.items[0].status, 'cancelled')
  const amendedTask = await post(`${roomPath}/tasks`, { ...taskInput, title: '新增要求的任务' })
  assert.equal(amendedTask.code, 'OK', amendedTask.message)
  const amendedPath = `/bot-tasks/${amendedTask.data.task.id}`
  const old = await claimBotRun(db, 'task-test', limits)
  assert.ok(old)
  const oldLease = { id: old.id, epoch: old.lease_epoch, owner: 'task-test' }
  const beforeAppend = (await get(amendedPath)).data
  const added = await post(`${amendedPath}/append`, { version: beforeAppend.version, content: '使用新版验收范围' })
  assert.equal(added.code, 'OK', added.message)
  assert.equal(added.data.inputVersion, 2)
  await db.transaction((tx) => finishBotRun(tx, oldLease, { status: 'succeeded' }))
  const afterOldRun = (await get(amendedPath)).data
  assert.equal(afterOldRun.inputVersion, 2)
  assert.equal(afterOldRun.status, 'waiting')
  assert.equal(afterOldRun.runs[0].inputVersion, 1)
})
