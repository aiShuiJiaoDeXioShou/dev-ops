import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createBotDelegation, type BotActor } from '../../src/modules/identity/identity.bot-delegation.ts'
import { createTestApp } from '../support/create-test-app.ts'
import { requireActor, requireSessionActor } from '../../src/modules/identity/identity.actor.ts'

test('Bot 委托只能用于持有同一凭据存储的单次内部请求', async (t) => {
  const delegation = createBotDelegation()
  const app = createTestApp({}, { botDelegation: delegation })
  const external = createTestApp()
  t.after(async () => {
    await Promise.all([app.close(), external.close()])
  })
  for (const application of [app, external]) {
    application.get('/internal-test-actor', async (request) => (await requireActor(request)).id)
    application.get('/internal-test-session', async (request) => (await requireSessionActor(request)).id)
  }
  const actor: BotActor = {
    credential: 'bot',
    user: { id: 'user', name: '测试用户', email: 'fixture@example.test' },
    viaBotId: 'bot',
    runId: 'run',
    teamId: 'team',
    leaseEpoch: 1,
  }
  await delegation.withToken(actor, async (token) => {
    const options = { url: '/internal-test-actor', headers: { authorization: `Bearer ${token}` } }
    const outside = await external.inject(options)
    assert.equal(outside.json().code, 'UNAUTHENTICATED')
    const inside = await app.inject(options)
    assert.equal(inside.body, actor.user.id)
    const replay = await app.inject(options)
    assert.equal(replay.json().code, 'UNAUTHENTICATED')
  })
  await delegation.withToken(actor, async (token) => {
    const result = await app.inject({ url: '/internal-test-session', headers: { authorization: `Bearer ${token}` } })
    assert.equal(result.json().code, 'FORBIDDEN')
  })
})
