import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { openApiTools } from '@dev-ops/devops-bot'
import { testApiInvoker } from '@dev-ops/devops-bot/testing'
import { and, eq } from 'drizzle-orm'
import { createHttpApp } from '../../src/bootstrap/create-http-app.ts'
import { catalogBotApis } from '../../src/modules/bots/bots.api-catalog.ts'
import { botApiExclusion, type BotApiMethod } from '../../src/modules/bots/bots.api-denylist.ts'
import { claimBotRun, renewBotRunLease } from '../../src/modules/bots/bots.run-queue.repository.ts'
import { botApiCall } from '../../src/modules/bots/bots.tables.ts'
import { createBotApiInvoker } from '../../src/modules/bots/runtime/api-invoker.ts'
import { createBotDelegation } from '../../src/modules/identity/identity.bot-delegation.ts'
import { teamMember } from '../../src/modules/identity/identity.tables.ts'
import { createBotTestDatabase } from '../support/bot-database.ts'
import { seedBotWorkflowFixture } from '../support/bot-workflow-fixtures.ts'

test('平台 API 委托使用团队范围与当前成员角色，写入只执行一次并关联 Bot', async (t) => {
  const { db, config, cleanup } = await createBotTestDatabase(t)
  const delegation = createBotDelegation()
  const app = createHttpApp(
    {
      ...config,
      DOCS_ENABLED: true,
      GIT_CREDENTIAL_ENCRYPTION_KEY: Buffer.alloc(32, 72).toString('base64'),
    },
    { botDelegation: delegation },
  )
  cleanup.push(() => app.close())
  const { teamPath, teamId, otherTeamId, otherUser, roomId, roomPath, adminUser, botId, devUser, post, get } =
    await seedBotWorkflowFixture(app)
  const own = await post(`${teamPath}/projects`, { name: '当前团队项目' }, adminUser)
  assert.equal(own.code, 'OK', own.message)
  const foreign = await post(`/teams/${otherTeamId}/projects`, { name: '其他团队项目' }, otherUser)
  assert.equal(foreign.code, 'OK', foreign.message)
  await db
    .insert(teamMember)
    .values({ id: randomUUID(), team_id: otherTeamId, user_id: devUser.userId, role: 'developer', status: 'active' })
  const otherPath = `/projects/${foreign.data.id}`
  assert.equal((await get(otherPath)).code, 'OK')
  const selected = await post(`${roomPath}/messages`, { clientRequestId: randomUUID(), text: '在当前团队创建一条需求' })
  assert.equal(selected.code, 'OK', selected.message)
  const run = await claimBotRun(db, 'delegate-test', { global: 3, perTeam: 2, ttlSeconds: 60 })
  assert.ok(run)
  const lease = { id: run.id, owner: 'delegate-test', epoch: run.lease_epoch }
  const swagger = app.swagger()
  const catalog = catalogBotApis(swagger)
  for (const [path, operations] of Object.entries(swagger.paths ?? {})) {
    for (const method of ['GET', 'POST'] as const) {
      if (!(method.toLowerCase() in (operations ?? {}))) continue
      assert.notEqual(
        catalog.some((item) => item.method === method && item.path === path),
        Boolean(botApiExclusion(method, path)),
        `${method} ${path}`,
      )
    }
  }
  const createInvoker = (current = lease) =>
    createBotApiInvoker({ app, db, lease: current, delegation, teamId, conversationId: roomId, botId, catalog })
  const api = createInvoker()
  const search = openApiTools(catalog, api).find(({ name }) => name === 'platform_api_search')
  assert.ok(search)
  const signal = new AbortController().signal
  for (const [query, path] of [
    ['团队列表', '/api/v1/me/teams'],
    ['团队成员', '/api/v1/teams/{teamId}/members'],
    ['团队 项目', '/api/v1/teams/{teamId}/projects'],
  ]) {
    const result = await search.execute({ query }, signal)
    assert.ok(result.text.includes(`"path":"${path}"`), result.text)
  }
  const path = `/api/v1/projects/${own.data.id}/requirements`
  assert.equal((await api.invoke({ method: 'GET', path })).ok, true)
  assert.equal((await api.invoke({ method: 'GET', path: `/api/v1${otherPath}` })).code, 'BOT_API_FORBIDDEN')
  assert.equal((await api.invoke({ method: 'GET', path: '/api/v1/me/tokens' })).code, 'BOT_API_FORBIDDEN')
  assert.equal(
    (await api.invoke({ method: 'GET', path: `/api/v1/teams/${otherTeamId}/projects` })).code,
    'BOT_API_FORBIDDEN',
  )
  assert.equal(
    (await createInvoker({ ...lease, epoch: lease.epoch + 1 }).invoke({ method: 'GET', path })).code,
    'BOT_API_FORBIDDEN',
  )
  assert.equal((await api.invoke({ method: 'GET', path: '/api/v1/%2e%2e/health' })).code, 'BOT_API_FORBIDDEN')

  const write = {
    method: 'POST',
    path,
    body: { title: '委托创建需求', contentMode: 'markdown', contentMarkdown: '核验委托创建' },
    idempotencyKey: 'same-action',
  } as const
  const first = await api.invoke(write)
  assert.equal(first.code, 'OK', JSON.stringify(first))
  const repeat = await api.invoke(write)
  assert.equal(repeat.code, 'OK')
  assert.deepEqual(repeat.data, {
    id: first.data && typeof first.data === 'object' && 'id' in first.data ? first.data.id : null,
  })
  const list = await get(`/projects/${own.data.id}/requirements`)
  assert.equal(list.data.items.length, 1)
  const history = await get(`/requirements/${list.data.items[0].id}/activities`)
  assert.equal(history.data.items[0].viaBotId, botId)
  assert.equal(history.data.items[0].actorUserId, devUser.userId)
  await testApiInvoker(t, async () => ({
    api,
    read: { method: 'GET', path },
    write: { ...write, idempotencyKey: 'contract-suite', body: { ...write.body, title: '端口一致性需求' } },
    denied: { method: 'GET', path: '/api/v1/me/tokens' },
    countWrites: async () => (await get(`/projects/${own.data.id}/requirements`)).data.items.length,
  }))
  const unknownWrite = { ...write, idempotencyKey: 'unknown-action' }
  const failedTransport = t.mock.method(app, 'inject', () => {
    throw new Error('模拟平台在写调用时失去响应')
  })
  try {
    const unknown = await api.invoke(unknownWrite)
    const retried = await api.invoke(unknownWrite)
    assert.equal(unknown.ok, false)
    assert.equal(retried.ok, false)
    assert.equal(unknown.code, 'BOT_API_RESULT_UNKNOWN')
    assert.equal(retried.code, unknown.code)
    assert.equal(failedTransport.mock.callCount(), 1)
  } finally {
    failedTransport.mock.restore()
  }
  const [unknownRecord] = await db
    .select({ status: botApiCall.status, code: botApiCall.result_code })
    .from(botApiCall)
    .where(and(eq(botApiCall.run_id, run.id), eq(botApiCall.idempotency_key, unknownWrite.idempotencyKey)))
  assert.deepEqual(unknownRecord, { status: 'unknown', code: 'BOT_API_RESULT_UNKNOWN' })
  await delegation.withToken(
    {
      user: { id: devUser.userId, email: 'fixture@example.test', name: '开发者' },
      credential: 'bot',
      teamId,
      viaBotId: botId,
      runId: run.id,
      leaseEpoch: run.lease_epoch,
    },
    async (token) => {
      const response = await app.inject({ url: '/api/v1/me/tokens', headers: { authorization: `Bearer ${token}` } })
      assert.equal(response.json().code, 'FORBIDDEN')
    },
  )

  await db.update(teamMember).set({ role: 'viewer' }).where(eq(teamMember.user_id, devUser.userId))
  assert.equal((await api.invoke({ ...write, idempotencyKey: 'viewer-attempt' })).code, 'FORBIDDEN')
  assert.equal((await api.invoke({ method: 'GET', path })).ok, true)
  const disabled = await post(`${teamPath}/members/${devUser.userId}/update`, { status: 'disabled' }, adminUser)
  assert.equal(disabled.code, 'OK', disabled.message)
  assert.deepEqual(await renewBotRunLease(db, lease, 60), { stopRequested: true })
  assert.equal((await api.invoke({ method: 'GET', path })).code, 'BOT_API_FORBIDDEN')
})

test('R5 对每一现有排除类别和保留的读取方法做明确分类', () => {
  const examples: [BotApiMethod, string, string | undefined][] = [
    ['POST', '/teams/{teamId}/members/{userId}/update', 'team_membership'],
    ['GET', '/teams/{teamId}/members', undefined],
    ['GET', '/teams/{teamId}/invitations', 'team_membership'],
    ['POST', '/credentials/{credentialId}/reveal-value', 'credentials'],
    ['GET', '/projects/{projectId}/environments/{environment}/variables', 'credentials'],
    ['POST', '/pipeline-nodes/{nodeId}/tokens/rotate', 'tokens'],
    ['GET', '/projects/{projectId}/tools/grants', 'capability_grants'],
    ['POST', '/change-plans/{planId}/approve', 'change_approval'],
    ['GET', '/skills/{skillId}', undefined],
    ['POST', '/skills/{skillId}/enable', 'skills_management'],
    ['POST', '/bots/{botId}/update', 'bot_management'],
    ['GET', '/bot-model-login-sessions/{sessionId}', 'bot_management'],
    ['POST', '/bot-tasks/{taskId}/request-changes', 'bot_management'],
    ['GET', '/auth/{*}', 'authentication'],
  ]
  for (const [method, path, category] of examples) assert.equal(botApiExclusion(method, `/api/v1${path}`), category)
})
