import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { eq, sql } from 'drizzle-orm'
import { createHttpApp } from '../../src/bootstrap/create-http-app.ts'
import { claimBotRun } from '../../src/modules/bots/bots.run-queue.repository.ts'
import { issueBotRunToken, authenticateBotRunToken, revokeBotRunToken } from '../../src/modules/bots/bots.run-tokens.ts'
import { botApiCall, botRun, botRunToken } from '../../src/modules/bots/bots.tables.ts'
import { botApiExclusion } from '../../src/modules/bots/bots.api-denylist.ts'
import { createBotTestDatabase } from '../support/bot-database.ts'
import { seedBotWorkflowFixture } from '../support/bot-workflow-fixtures.ts'

test('运行令牌跨 HTTP 校验、按成员授权、审计并随停止和租约失效', async (t) => {
  const { db, config, cleanup } = await createBotTestDatabase(t)
  const app = createHttpApp({
    ...config,
    DOCS_ENABLED: true,
    GIT_CREDENTIAL_ENCRYPTION_KEY: Buffer.alloc(32, 72).toString('base64'),
  })
  cleanup.push(() => app.close())
  const { teamPath, roomPath, post, otherUser } = await seedBotWorkflowFixture(app)
  await post(`${roomPath}/messages`, { clientRequestId: randomUUID(), text: '查询项目' })
  const run = await claimBotRun(db, 'run-token-test', { global: 3, perTeam: 2, ttlSeconds: 60 })
  assert.ok(run)
  const lease = { id: run.id, owner: 'run-token-test', epoch: run.lease_epoch }
  const token = await issueBotRunToken(db, lease)
  const [stored] = await db
    .select({ hash: botRunToken.token_hash })
    .from(botRunToken)
    .where(eq(botRunToken.run_id, run.id))
  assert.ok(stored)
  assert.notEqual(stored.hash, token)
  assert.equal(stored.hash.length, 64)
  const request = (url: string) =>
    app.inject({ method: 'GET', url: `/api/v1${url}`, headers: { authorization: `Bearer ${token}` } })
  assert.equal((await request(`${teamPath}/projects`)).json().code, 'OK')
  assert.equal((await request(`${teamPath}/members`)).json().code, 'BOT_API_FORBIDDEN')
  assert.equal((await request('/me/tokens')).json().code, 'OK')
  const ownToken = await app.tokenService.create(run.trigger_user_id, { name: '可撤销的个人令牌' })
  const foreignToken = await app.tokenService.create(otherUser.userId, { name: '其他成员令牌' })
  const write = (url: string, payload: object = {}) =>
    app.inject({
      method: 'POST',
      url: `/api/v1${url}`,
      payload,
      headers: { authorization: `Bearer ${token}` },
    })
  assert.equal((await write(`/me/tokens/${ownToken.metadata.id}/revoke`)).json().code, 'OK')
  assert.equal(await app.tokenService.authenticate(ownToken.token), null)
  assert.equal((await write(`/me/tokens/${foreignToken.metadata.id}/revoke`)).json().code, 'TOKEN_NOT_FOUND')
  assert.ok(await app.tokenService.authenticate(foreignToken.token))
  assert.equal((await write('/me/tokens', { name: '不允许签发' })).json().code, 'BOT_API_FORBIDDEN')
  assert.equal((await write(`/pipeline-nodes/${randomUUID()}/tokens/rotate`)).json().code, 'BOT_API_FORBIDDEN')
  assert.equal((await write(`${teamPath}/pipeline-nodes`)).json().code, 'BOT_API_FORBIDDEN')
  assert.equal((await write('/agent/register')).json().code, 'BOT_API_FORBIDDEN')
  const records = await db
    .select({ target: botApiCall.target, result: botApiCall.result_ref })
    .from(botApiCall)
    .where(eq(botApiCall.run_id, run.id))
  assert.equal(records.length, 9)
  assert.ok(records.every(({ result }) => result && typeof result === 'object' && 'elapsedMs' in result))
  await db.update(botRun).set({ stop_requested: true }).where(eq(botRun.id, run.id))
  assert.equal(await authenticateBotRunToken(db, token), null)
  assert.equal((await request(`${teamPath}/projects`)).json().code, 'UNAUTHENTICATED')
  await db
    .update(botRun)
    .set({ stop_requested: false, lease_epoch: run.lease_epoch + 1 })
    .where(eq(botRun.id, run.id))
  assert.equal(await authenticateBotRunToken(db, token), null)
  await db
    .update(botRun)
    .set({ lease_epoch: run.lease_epoch, lease_until: sql`clock_timestamp() - interval '1 second'` })
    .where(eq(botRun.id, run.id))
  assert.equal(await authenticateBotRunToken(db, token), null)
  await revokeBotRunToken(db, lease)
  assert.equal(await authenticateBotRunToken(db, token), null)
  assert.equal(botApiExclusion('POST', '/api/v1/teams/{teamId}/pipeline-nodes'), 'tokens')
  assert.equal(botApiExclusion('POST', '/api/v1/agent/register'), 'tokens')
  assert.equal(botApiExclusion('POST', '/api/v1/agent/heartbeat'), undefined)
  assert.equal(botApiExclusion('POST', '/api/v1/agent/lease'), undefined)
  assert.equal(botApiExclusion('POST', '/api/v1/teams/{teamId}/bot-model-connections/oauth-login'), 'authentication')
  for (const [path, operations] of Object.entries(app.swagger().paths ?? {})) {
    for (const method of ['GET', 'POST'] as const) {
      if (!(method.toLowerCase() in (operations ?? {}))) continue
      if (/\/tokens(?:\/|$)/u.test(path)) {
        const issuesToken =
          method === 'POST' &&
          (path === '/api/v1/me/tokens' || path === '/api/v1/pipeline-nodes/{nodeId}/tokens/rotate')
        assert.equal(botApiExclusion(method, path), issuesToken ? 'tokens' : undefined, `${method} ${path}`)
      }
      if (/\/auth(?:\/|$)|\/invitations(?:\/|$)|\/members(?:\/|$)|\/reveal-value$/u.test(path)) {
        assert.ok(botApiExclusion(method, path), `${method} ${path}`)
      }
    }
  }
})
