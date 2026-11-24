import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { createHttpApp } from '../../src/bootstrap/create-http-app.ts'
import { claimBotRun, finishBotRun, isConversationBotRun } from '../../src/modules/bots/bots.run-queue.repository.ts'
import { createTodoTool } from '../../src/modules/bots/runtime/todo-tools.ts'
import { createBotTestDatabase } from '../support/bot-database.ts'
import { seedBotWorkflowFixture } from '../support/bot-workflow-fixtures.ts'

test('等你回复汇总只读可见会话，新运行取代提问状态，失败继续等待成员回复', async (t) => {
  const { db, config, cleanup } = await createBotTestDatabase(t)
  const app = createHttpApp({ ...config, GIT_CREDENTIAL_ENCRYPTION_KEY: Buffer.alloc(32, 28).toString('base64') })
  cleanup.push(() => app.close())
  const { roomPath, teamPath, adminUser, get, post } = await seedBotWorkflowFixture(app)
  const inbox = `${teamPath}/bot-inbox`
  assert.equal((await get(inbox)).data.count, 0)
  await post(`${roomPath}/messages`, { clientRequestId: randomUUID(), text: '开始工作' })
  const run = await claimBotRun(db, 'reply-test', { global: 3, perTeam: 2, ttlSeconds: 60 })
  assert.ok(run && isConversationBotRun(run))
  const lease = { id: run.id, owner: 'reply-test', epoch: run.lease_epoch }
  await createTodoTool(db, run, lease).execute({ items: [], needsReply: true }, new AbortController().signal)
  assert.equal((await get(inbox)).data.count, 0)
  await db.transaction((tx) => finishBotRun(tx, lease, { status: 'succeeded' }))
  assert.equal((await get(inbox)).data.count, 1)
  assert.equal((await get(inbox, adminUser)).data.count, 0)
  assert.equal((await get(`${teamPath}/bot-conversations`)).data.items[0].workStatus, 'awaiting_reply')
  await post(`${roomPath}/messages`, { clientRequestId: randomUUID(), text: '继续' })
  assert.equal((await get(inbox)).data.count, 0)
  const next = await claimBotRun(db, 'reply-test', { global: 3, perTeam: 2, ttlSeconds: 60 })
  assert.ok(next)
  await db.transaction((tx) =>
    finishBotRun(
      tx,
      { id: next.id, owner: 'reply-test', epoch: next.lease_epoch },
      { status: 'failed', failureKind: 'tool_error', failureMessage: '测试失败' },
    ),
  )
  assert.equal((await get(inbox)).data.count, 1)
})
