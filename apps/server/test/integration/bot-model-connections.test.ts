import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { and, eq } from 'drizzle-orm'
import { createHttpApp } from '../../src/bootstrap/create-http-app.ts'
import { publishBotModelCatalog } from '../../src/modules/bots/bots.catalog.ts'
import { botLoginSession, botModelConnection } from '../../src/modules/bots/bots.tables.ts'
import { createPgCredentialStore } from '../../src/modules/bots/runtime/credential-store.ts'
import { runPendingBotLogin } from '../../src/modules/bots/runtime/login-runner.ts'
import { createSecretCipher } from '../../src/modules/configuration/configuration.crypto.ts'
import { credential, credentialVersion } from '../../src/modules/configuration/configuration.tables.ts'
import { teamMember } from '../../src/modules/identity/identity.tables.ts'
import { createBotTestDatabase } from '../support/bot-database.ts'
import { seedKnowledgeFixture } from '../support/knowledge-fixtures.ts'

test('团队模型连接使用加密凭据，订阅授权只允许发起人且降级立即停用', { timeout: 30_000 }, async (t) => {
  const { db, config, cleanup } = await createBotTestDatabase(t)
  const encodedKey = Buffer.alloc(32, 13).toString('base64')
  const cipher = createSecretCipher(encodedKey)
  const app = createHttpApp({ ...config, GIT_CREDENTIAL_ENCRYPTION_KEY: encodedKey })
  cleanup.push(() => app.close())
  const { adminUser, devUser, otherUser, teamId } = await seedKnowledgeFixture(app)
  await db
    .update(teamMember)
    .set({ role: 'admin' })
    .where(and(eq(teamMember.user_id, devUser.userId), eq(teamMember.team_id, teamId)))
  await publishBotModelCatalog(db, [
    {
      providerId: 'fixture',
      modelId: 'chat',
      displayName: '测试模型',
      authTypes: ['api_key', 'oauth'],
      contextWindow: 8192,
    },
  ])
  const connectionList = `/api/v1/teams/${teamId}/bot-model-connections`
  async function get(url: string, user: { cookie: string }) {
    const result = await app.inject({ url, headers: { cookie: user.cookie } })
    assert.equal(result.statusCode, 200)
    return result.json()
  }
  async function post(url: string, user: { cookie: string }, payload: object) {
    const result = await app.inject({
      method: 'POST',
      url,
      payload,
      headers: { cookie: user.cookie, 'idempotency-key': randomUUID() },
    })
    assert.equal(result.statusCode, 200)
    return result.json()
  }

  const apiKey = 'fixture-api-key-only'
  const created = await post(connectionList, adminUser, { name: '测试 API', apiKey, providerId: 'fixture' })
  assert.equal(created.code, 'OK', created.message)
  assert.ok(!JSON.stringify(created).includes(apiKey))
  const [saved] = await db.select().from(credential).where(eq(credential.team_id, teamId))
  assert.equal(saved?.kind, 'model_api_key')
  const [version] = await db.select().from(credentialVersion).where(eq(credentialVersion.credential_id, saved.id))
  assert.ok(version?.ciphertext && version.ciphertext !== apiKey)
  assert.equal(
    (await post(connectionList, adminUser, { name: '错误提供方', apiKey, providerId: 'missing' })).code,
    'BOT_MODEL_NOT_IN_CATALOG',
  )
  assert.equal((await get(connectionList, otherUser)).code, 'FORBIDDEN')
  const secret = await createPgCredentialStore({ db, cipher, teamId, connectionId: created.data.id }).read('fixture')
  assert.equal(secret?.type === 'api_key' && secret.key, apiKey)

  const login = await post(`${connectionList}/oauth-login`, devUser, { name: '测试订阅', providerId: 'fixture' })
  assert.equal(login.code, 'OK', login.message)
  const sessionUrl = `/api/v1/bot-model-login-sessions/${login.data.loginSessionId}`
  assert.equal((await get(sessionUrl, adminUser)).code, 'NOT_FOUND')
  assert.equal((await get(connectionList, adminUser)).data.length, 1)
  const cancellation = new AbortController()
  cleanup.push(async () => cancellation.abort())
  const job = runPendingBotLogin(
    db,
    'fixture-login',
    async (provider, interaction, store) => {
      interaction.notify({ kind: 'auth_url', url: 'https://auth.example.test/authorize' })
      const answer = await interaction.answer({ kind: 'manual_code', message: '粘贴验证码' }, interaction.signal)
      assert.equal(answer, 'fixture-answer')
      await store.modify(provider, async () => ({
        type: 'oauth',
        access: 'fixture-oauth-access',
        refresh: 'fixture-oauth-refresh',
        expires: 500,
      }))
    },
    cipher,
    cancellation.signal,
  )
  let current = await get(sessionUrl, devUser)
  for (let attempt = 0; !current.data?.prompt?.question && attempt < 25; attempt++) {
    await delay(80)
    current = await get(sessionUrl, devUser)
  }
  assert.equal(current.data.status, 'waiting_user')
  assert.equal(current.data.prompt.url, 'https://auth.example.test/authorize')
  const answered = await post(`${sessionUrl}/answer`, devUser, { value: 'fixture-answer' })
  assert.equal(answered.code, 'OK')
  assert.ok(!JSON.stringify(answered).includes('fixture-answer'))
  await job
  assert.equal((await get(sessionUrl, devUser)).data.status, 'succeeded')
  const [session] = await db
    .select()
    .from(botLoginSession)
    .where(eq(botLoginSession.id, String(login.data.loginSessionId)))
  assert.equal(session?.answer_secret, null)
  const [oauth] = await db.select().from(botModelConnection).where(eq(botModelConnection.id, session.connection_id))
  assert.ok(oauth?.oauth_secret)
  assert.ok(!oauth.oauth_secret.includes('fixture-oauth-access'))

  const demoted = await post(`/api/v1/teams/${teamId}/members/${devUser.userId}/update`, adminUser, {
    role: 'developer',
  })
  assert.equal(demoted.code, 'OK', demoted.message)
  const [disabled] = await db.select().from(botModelConnection).where(eq(botModelConnection.id, oauth.id))
  assert.equal(disabled?.status, 'disabled')
  assert.equal(disabled.disabled_reason, 'login_user_demoted')
  assert.equal(
    (await post(connectionList, devUser, { name: '开发者不能创建', apiKey, providerId: 'fixture' })).code,
    'FORBIDDEN',
  )
  const viewerData = await get(connectionList, devUser)
  assert.equal(viewerData.data.length, 2)
  assert.ok(!JSON.stringify(viewerData).includes('fixture-oauth-access'))
})
