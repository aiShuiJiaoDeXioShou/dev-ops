import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { eq } from 'drizzle-orm'
import { createHttpApp } from '../../src/bootstrap/create-http-app.ts'
import { claimBotRun, isConversationBotRun } from '../../src/modules/bots/bots.run-queue.repository.ts'
import { botRunInput } from '../../src/modules/bots/bots.session.tables.ts'
import { createPgRunInputQueue, acknowledgeBotRunInputs } from '../../src/modules/bots/runtime/run-input-queue.ts'
import { readBotRoomSync } from '../../src/modules/bots/runtime/room-sync.ts'
import { createBotTestDatabase } from '../support/bot-database.ts'
import { seedBotWorkflowFixture } from '../support/bot-workflow-fixtures.ts'

test('撤回与领取互斥，追加等待工具结束，撤回内容不再进入模型上下文', async (t) => {
  const { db, config, cleanup } = await createBotTestDatabase(t)
  const app = createHttpApp({ ...config, GIT_CREDENTIAL_ENCRYPTION_KEY: Buffer.alloc(32, 19).toString('base64') })
  cleanup.push(() => app.close())
  const { roomPath, post, get } = await seedBotWorkflowFixture(app)
  const sent = await post(`${roomPath}/messages`, { text: '开始工作', clientRequestId: randomUUID() })
  assert.equal(sent.code, 'OK')
  const run = await claimBotRun(db, 'withdraw-test', { global: 5, perTeam: 5, ttlSeconds: 120 })
  assert.ok(run && isConversationBotRun(run))
  const queue = createPgRunInputQueue(db, run, { id: run.id, owner: 'withdraw-test', epoch: run.lease_epoch })
  const follow = await post(`${roomPath}/messages`, {
    text: '不会再执行的草稿',
    deliveryMode: 'auto',
    clientRequestId: randomUUID(),
  })
  assert.equal(follow.code, 'OK', follow.message)
  assert.deepEqual(await queue.take({ allowFollowUp: false }), [])
  assert.equal((await get(`${roomPath}/queued-inputs`)).data.items.length, 1)
  const withdrawn = await post(`${roomPath}/messages/${follow.data.message.id}/withdraw`, {})
  assert.equal(withdrawn.code, 'OK', withdrawn.message)
  assert.deepEqual(await queue.take({ allowFollowUp: true }), [])
  assert.equal((await get(`${roomPath}/queued-inputs`)).data.items.length, 0)
  const room = await readBotRoomSync(
    db,
    { ...run, trigger_message_id: null, started_at: new Date(Date.now() + 1000) },
    50,
  )
  assert.doesNotMatch(
    JSON.stringify(room, (_, value) => (typeof value === 'bigint' ? String(value) : value)),
    /不会再执行的草稿/u,
  )

  const steer = await post(`${roomPath}/messages`, {
    text: '并发消费',
    deliveryMode: 'steer',
    clientRequestId: randomUUID(),
  })
  const id = String(steer.data.message.id)
  const [taken, cancellation] = await Promise.all([
    queue.take({ allowFollowUp: false }),
    post(`${roomPath}/messages/${id}/withdraw`, {}),
  ])
  assert.ok(cancellation.code === 'OK' || cancellation.code === 'VERSION_CONFLICT')
  assert.equal(
    taken.some((item) => item.messageId === id),
    cancellation.code === 'VERSION_CONFLICT',
  )
  const [row] = await db.select({ status: botRunInput.status }).from(botRunInput).where(eq(botRunInput.message_id, id))
  assert.equal(row?.status, cancellation.code === 'OK' ? 'withdrawn' : 'delivering')
  if (taken.length) {
    await db.transaction((tx) =>
      acknowledgeBotRunInputs(
        tx,
        run,
        taken.map((item) => item.messageId),
      ),
    )
    assert.deepEqual(await queue.take({ allowFollowUp: true }), [])
  }
})
