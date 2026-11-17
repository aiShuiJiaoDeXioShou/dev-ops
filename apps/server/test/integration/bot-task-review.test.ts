import assert from 'node:assert/strict'
import { test } from 'node:test'
import { eq } from 'drizzle-orm'
import { createHttpApp } from '../../src/bootstrap/create-http-app.ts'
import { claimBotRun, finishBotRun } from '../../src/modules/bots/bots.run-queue.repository.ts'
import { createTaskResultTool } from '../../src/modules/bots/runtime/task-tools.ts'
import { teamMember } from '../../src/modules/identity/identity.tables.ts'
import { botTaskReview } from '../../src/modules/tasks/bot-tasks.tables.ts'
import { createBotTestDatabase } from '../support/bot-database.ts'
import { seedBotWorkflowFixture } from '../support/bot-workflow-fixtures.ts'

test('任务结果提交、退回继续执行与并发验收独立生效，待处理按会话权限更新', async (t) => {
  const { db, config, cleanup } = await createBotTestDatabase(t)
  const app = createHttpApp({ ...config, GIT_CREDENTIAL_ENCRYPTION_KEY: Buffer.alloc(32, 29).toString('base64') })
  cleanup.push(() => app.close())
  const { adminUser, devUser, roomPath, teamPath, get, post } = await seedBotWorkflowFixture(app)
  const inboxPath = `${teamPath}/bot-inbox`
  const taskInput = { title: '核对验收', businessOwnerId: devUser.userId, acceptanceCriteria: '保留可复核的证据' }
  const created = await post(`${roomPath}/tasks`, taskInput)
  assert.equal(created.code, 'OK', created.message)
  const taskId = String(created.data.task.id)
  const taskPath = `/bot-tasks/${taskId}`
  const limits = { global: 3, perTeam: 2, ttlSeconds: 30 }
  const running = await claimBotRun(db, 'review-test', limits)
  assert.ok(running)
  const lease = { id: running.id, owner: 'review-test', epoch: running.lease_epoch }
  const tool = createTaskResultTool(db, lease)
  const signal = new AbortController().signal
  const input = { body: '检查完成', completionNote: '查验文件清单', evidence: ['日志链接 https://example.test/review'] }

  const unsafe = await tool.execute({ ...input, body: `sk-${'a'.repeat(45)}` }, signal)
  assert.equal(unsafe.isError, true)
  assert.equal((await get(inboxPath)).data.count, 0)
  assert.equal((await tool.execute(input, signal)).isError, undefined)
  assert.equal((await tool.execute(input, signal)).isError, undefined)
  const awaiting = (await get(taskPath)).data
  assert.equal(awaiting.results.length, 1)
  assert.equal(awaiting.status, 'awaiting_review')
  assert.equal((await get(inboxPath)).data.items[0].id, taskId)
  assert.equal((await get(inboxPath, adminUser)).data.count, 0)

  const result = { resultId: awaiting.results[0].id }
  await db.update(teamMember).set({ role: 'viewer' }).where(eq(teamMember.user_id, devUser.userId))
  assert.equal((await post(`${taskPath}/accept`, result)).code, 'FORBIDDEN')
  assert.equal((await get(inboxPath)).data.count, 1)
  await db.update(teamMember).set({ role: 'developer' }).where(eq(teamMember.user_id, devUser.userId))
  const returned = await post(`${taskPath}/request-changes`, { ...result, comment: '补充复查日期' })
  assert.equal(returned.code, 'OK', returned.message)
  assert.equal(returned.data.task.status, 'in_progress')
  assert.equal(returned.data.review.comment, '补充复查日期')
  assert.equal((await get(inboxPath)).data.count, 0)

  await db.transaction((tx) => finishBotRun(tx, lease, { status: 'succeeded' }))
  const rework = await claimBotRun(db, 'review-test', limits)
  assert.ok(rework)
  assert.equal(rework.input_version, 2)
  const nextTool = createTaskResultTool(db, { id: rework.id, owner: 'review-test', epoch: rework.lease_epoch })
  const revised = { ...input, body: '已补充复查日期' }
  assert.equal((await nextTool.execute(revised, signal)).isError, undefined)
  const current = (await get(taskPath)).data
  const nextResult = { resultId: current.results[0].id }
  const responses = await Promise.all([post(`${taskPath}/accept`, nextResult), post(`${taskPath}/accept`, nextResult)])
  assert.deepEqual(responses.map(({ code }) => code).sort(), ['BOT_TASK_STATE_CONFLICT', 'OK'])
  assert.equal((await get(inboxPath)).data.count, 0)
  assert.equal((await get(taskPath)).data.status, 'completed')
  assert.equal((await nextTool.execute(revised, signal)).isError, true)
  assert.equal(
    (await db.select({ id: botTaskReview.id }).from(botTaskReview).where(eq(botTaskReview.task_id, taskId))).length,
    2,
  )
})
