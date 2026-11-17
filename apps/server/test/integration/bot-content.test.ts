import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { createHttpApp } from '../../src/bootstrap/create-http-app.ts'
import { claimBotRun } from '../../src/modules/bots/bots.run-queue.repository.ts'
import { createPgRunSink } from '../../src/modules/bots/runtime/run-sink.ts'
import { createBotTestDatabase } from '../support/bot-database.ts'
import { seedBotWorkflowFixture } from '../support/bot-workflow-fixtures.ts'

test('消息、增量事件与最终正文均在落库前遮蔽凭据内容', async (t) => {
  const { db, config, cleanup } = await createBotTestDatabase(t)
  const app = createHttpApp({ ...config, GIT_CREDENTIAL_ENCRYPTION_KEY: Buffer.alloc(32, 67).toString('base64') })
  cleanup.push(() => app.close())
  const { roomPath, get, post } = await seedBotWorkflowFixture(app)
  const credential = `ghp_${'test-fixture-value'.repeat(3)}`
  const send = await post(`${roomPath}/messages`, { text: `用户输入 ${credential}`, clientRequestId: randomUUID() })
  assert.equal(send.code, 'OK', send.message)
  assert.match(send.data.message.body.blocks[0].text, /疑似凭据/u)
  const run = await claimBotRun(db, 'redaction-test', { global: 3, perTeam: 2, ttlSeconds: 60 })
  assert.ok(run)
  const sink = createPgRunSink(db, run, { id: run.id, owner: 'redaction-test', epoch: run.lease_epoch }, () =>
    assert.fail('事件写入失败'),
  )
  await sink.emit({ type: 'output_delta', seq: 1, payload: { text: credential } })
  await sink.finish({
    status: 'succeeded',
    turns: 1,
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0 },
    finalMessage: { role: 'assistant', blocks: [{ type: 'text', text: `回复内容 ${credential}` }] },
  })
  const messages = await get(`${roomPath}/messages`)
  const events = await get(`${roomPath}/events`)
  assert.equal(messages.code, 'OK', messages.message)
  assert.equal(events.code, 'OK', events.message)
  assert.equal(messages.data.items.length, 2)
  assert.ok(!JSON.stringify(messages.data).includes(credential))
  assert.ok(!JSON.stringify(events.data).includes(credential))
  assert.match(
    events.data.items.find(({ kind }: { kind: string }) => kind === 'output_delta').payload.text,
    /疑似凭据/u,
  )
})
