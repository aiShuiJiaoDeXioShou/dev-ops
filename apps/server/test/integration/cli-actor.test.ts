import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { and, eq } from 'drizzle-orm'
import { createHttpApp } from '../../src/bootstrap/create-http-app.ts'
import { createBotDelegation } from '../../src/modules/identity/identity.bot-delegation.ts'
import { platformAdmin, teamMember } from '../../src/modules/identity/identity.tables.ts'
import { createBotTestDatabase } from '../support/bot-database.ts'
import { seedKnowledgeFixture } from '../support/knowledge-fixtures.ts'

test('个人令牌继承实时角色，登录会话专用操作和 Bot 委托权限保持隔离', { timeout: 90_000 }, async (t) => {
  const { config, cleanup } = await createBotTestDatabase(t)
  const botDelegation = createBotDelegation()
  const app = createHttpApp(
    {
      ...config,
      GIT_CREDENTIAL_ENCRYPTION_KEY: Buffer.alloc(32, 83).toString('base64'),
    },
    { botDelegation },
  )
  cleanup.push(() => app.close())
  const { teamId, otherTeamId, adminUser, devUser } = await seedKnowledgeFixture(app)
  const issued = await app.tokenService.create(adminUser.userId, { name: '已有个人令牌' })
  const headers = { authorization: `Bearer ${issued.token}` }
  const listBuckets = '/api/v1/platform/storage-buckets'
  const recycleBin = `/api/v1/teams/${teamId}/project-recycle-bin`

  assert.equal((await app.inject({ url: recycleBin, headers })).json().success, true)
  assert.equal((await app.inject({ url: '/api/v1/me/github-account', headers })).json().success, true)
  assert.equal((await app.inject({ url: listBuckets, headers })).json().code, 'FORBIDDEN')
  await app.db.insert(platformAdmin).values({ user_id: adminUser.userId })
  assert.equal((await app.inject({ url: listBuckets, headers })).json().success, true)

  const skillsUrl = `/api/v1/teams/${teamId}/skills`
  const payload = {
    name: '命令行验收',
    identifier: 'cli-skill',
    category: 'engineering',
    contentVersion: '1.0.0',
    summary: '测试协作流程',
    content: '查看事项与交付。',
  }
  const skill = await app.inject({ method: 'POST', url: skillsUrl, headers, payload })
  assert.equal(skill.json().success, true, skill.body)
  const unauthorized = await app.inject({ url: `/api/v1/teams/${otherTeamId}/skills`, headers })
  assert.equal(unauthorized.json().success, false)
  await app.db
    .update(teamMember)
    .set({ role: 'viewer', updated_at: new Date() })
    .where(and(eq(teamMember.user_id, adminUser.userId), eq(teamMember.team_id, teamId)))
  assert.equal((await app.inject({ url: recycleBin, headers })).json().code, 'FORBIDDEN')
  const noWrite = await app.inject({ method: 'POST', url: skillsUrl, headers, payload })
  assert.equal(noWrite.json().code, 'FORBIDDEN')

  const stableSessionOnly = [
    { url: '/api/v1/me/tokens', body: { name: '不得用旧令牌签发' } },
    { url: `/api/v1/projects/${randomUUID()}/remove`, body: { version: 1, password: 'test-password' } },
    { url: `/api/v1/projects/${randomUUID()}/cleanup-files`, body: { version: 1, password: 'test-password' } },
    { url: `/api/v1/credentials/${randomUUID()}/reveal-value`, body: { password: 'test-password' } },
    {
      url: `/api/v1/teams/${teamId}/bot-model-connections/oauth-login`,
      body: { name: '订阅连接', providerId: 'fixture' },
    },
  ]
  for (const { url, body } of stableSessionOnly) {
    const response = await app.inject({ method: 'POST', url, headers, payload: body })
    assert.equal(response.json().code, 'FORBIDDEN', url)
  }
  const github = await app.inject({
    method: 'POST',
    url: '/api/v1/me/github-account/authorize',
    headers,
    payload: { returnTo: '/settings/profile' },
  })
  assert.equal(github.json().code, 'UNAUTHENTICATED')

  await botDelegation.withToken(
    {
      user: { id: devUser.userId, email: 'dev@example.test', name: '开发者' },
      credential: 'bot',
      teamId,
      viaBotId: randomUUID(),
      runId: randomUUID(),
      leaseEpoch: 1,
    },
    async (token) => {
      const delegated = await app.inject({ url: skillsUrl, headers: { authorization: `Bearer ${token}` } })
      assert.equal(delegated.json().code, 'FORBIDDEN')
    },
  )

  await app.tokenService.revoke(adminUser.userId, issued.metadata.id)
  assert.equal((await app.inject({ url: listBuckets, headers })).json().code, 'UNAUTHENTICATED')
})
