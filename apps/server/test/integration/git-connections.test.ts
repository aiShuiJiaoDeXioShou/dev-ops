import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { eq } from 'drizzle-orm'
import { GitAdapterError } from '../../src/adapters/git/git.types.ts'
import { gitRepository } from '../../src/modules/code/code.tables.ts'
import { teamMember } from '../../src/modules/identity/identity.tables.ts'
import { createIntegrationsService } from '../../src/modules/integrations/integrations.service.ts'
import { loadConfig } from '../../src/platform/config/env.ts'
import { ApiError } from '../../src/platform/http/errors.ts'
import { createAuthenticatedUser } from '../support/auth.ts'
import { setupPipelineContext } from './pipeline-harness.ts'

test('GitHub App 多安装绑定、用户授权范围与重复授权', { timeout: 90_000 }, async (t) => {
  const context = await setupPipelineContext(t)
  const db = context.app.db
  const actor = { id: context.admin.userId, name: '团队管理员', email: 'admin@example.test' }
  const secondAdminUser = await createAuthenticatedUser(context.app, { name: '第二位管理员' })
  const secondAdmin = { id: secondAdminUser.userId, name: '第二位管理员', email: 'second-admin@example.test' }
  await db.insert(teamMember).values({
    id: randomUUID(),
    team_id: context.teamId,
    user_id: secondAdmin.id,
    role: 'admin',
    status: 'active',
  })
  const developer = { id: context.developer.userId, name: '开发者', email: 'developer@example.test' }
  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: context.runtimeUrl,
    AUTH_SECRET: 'test-auth-secret-at-least-32-characters',
    GITHUB_APP_SLUG: 'devops-test',
    GITHUB_APP_CLIENT_ID: 'Iv1_test',
    GITHUB_APP_CLIENT_SECRET: 'test-only-secret',
    GITHUB_APP_ID: '123',
    GITHUB_APP_PRIVATE_KEY_PATH: '/test/key.pem',
  })
  const expectedChallenges = new Map<string, string>()
  const service = createIntegrationsService({
    db,
    config,
    configuration: null,
    async adapterFactory(connection) {
      const account = connection.external_identity ?? ''
      return {
        async checkConnection() {
          return { identity: account }
        },
        async listRepositories() {
          return [
            {
              remoteId: account,
              namespace: `account-${account}`,
              name: 'project',
              webUrl: `https://github.com/account-${account}/project`,
              defaultBranch: 'main',
            },
          ]
        },
      }
    },
    githubInstallations: {
      async list(userId) {
        assert.equal(userId, actor.id)
        return [
          { id: 13, login: 'personal' },
          { id: 14, login: 'organization' },
        ]
      },
      async verify(userId, installationId) {
        assert.equal(userId, actor.id)
        if (installationId !== 13 && installationId !== 14) {
          throw new GitAdapterError('auth_failed', '当前 GitHub 用户无法访问该安装')
        }
        return { login: `account-${installationId}`, repositoryIds: new Set(installationId === 13 ? ['13'] : []) }
      },
    },
    async verifyGitHubInstallation(input) {
      assert.equal(
        createHash('sha256').update(input.codeVerifier).digest('base64url'),
        expectedChallenges.get(input.code),
      )
      const id = String(input.installationId)
      return { login: `account-${id}`, repositoryIds: new Set(input.code === 'limited' ? [] : [id]) }
    },
  })
  const denied = (error: unknown) => error instanceof ApiError && error.code === 'FORBIDDEN'
  const requestConnection = (user = actor) =>
    service.createConnection(user, context.teamId, { providerKey: 'github', name: 'GitHub' })
  await assert.rejects(() => requestConnection(developer), denied)

  async function startAuthorization(installationId: number, code: string, user = actor) {
    const pending = await requestConnection(user)
    assert.ok('authorizationUrl' in pending)
    const installUrl = new URL(pending.authorizationUrl)
    assert.equal(installUrl.pathname, '/apps/devops-test/installations/new')
    const state = installUrl.searchParams.get('state')
    assert.ok(state)
    await assert.rejects(() => service.completeAuthorization(developer, 'github', { state, installationId }), denied)
    const authorization = await service.completeAuthorization(user, 'github', { state, installationId })
    assert.ok('authorizationUrl' in authorization)
    const url = new URL(authorization.authorizationUrl)
    assert.equal(url.pathname, '/login/oauth/authorize')
    assert.equal(url.searchParams.get('prompt'), 'select_account')
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256')
    const challenge = url.searchParams.get('code_challenge')
    const oauthState = url.searchParams.get('state')
    assert.ok(challenge && oauthState)
    expectedChallenges.set(code, challenge)
    return { state: oauthState, code }
  }

  const limited = await startAuthorization(11, 'limited')
  await assert.rejects(() => service.completeAuthorization(actor, 'github', limited), denied)
  assert.equal(
    (await service.listConnections(actor, context.teamId)).some((row) => row.externalIdentity === '11'),
    false,
  )
  const first = await service.completeAuthorization(actor, 'github', await startAuthorization(11, 'first'))
  assert.ok('id' in first)
  assert.equal(first.name, 'GitHub account-11 (#11)')
  const secondState = await startAuthorization(12, 'second', secondAdmin)
  await assert.rejects(() => service.completeAuthorization(actor, 'github', secondState), denied)
  const second = await service.completeAuthorization(secondAdmin, 'github', secondState)
  assert.ok('id' in second)
  assert.notEqual(second.id, first.id)
  assert.equal(second.externalIdentity, '12')
  const projectRepositories = () =>
    db.select({ id: gitRepository.id }).from(gitRepository).where(eq(gitRepository.connection_id, first.id))
  const previous = await projectRepositories()
  assert.equal(previous.length, 1)
  const renewed = await service.completeAuthorization(actor, 'github', await startAuthorization(11, 'renew'))
  assert.ok('id' in renewed)
  assert.equal(renewed.id, first.id)
  assert.deepEqual(await projectRepositories(), previous)
  const appConnections = (await service.listConnections(actor, context.teamId)).filter(
    (row) => row.externalIdentity === '11' || row.externalIdentity === '12',
  )
  assert.deepEqual(new Set(appConnections.map((row) => row.id)), new Set([first.id, second.id]))

  const bindExisting = (installationId: number, user = actor) =>
    service.createConnection(user, context.teamId, { providerKey: 'github', name: 'GitHub', installationId })
  await assert.rejects(() => service.discoverGitHubInstallations(developer, context.teamId), denied)
  assert.deepEqual(await service.discoverGitHubInstallations(actor, context.teamId), [
    { id: 13, login: 'personal' },
    { id: 14, login: 'organization' },
  ])
  await assert.rejects(() => bindExisting(13, developer), denied)
  await assert.rejects(() => bindExisting(99), denied)
  await assert.rejects(() => bindExisting(14), denied)
  const existing = await bindExisting(13)
  assert.ok('id' in existing)
  assert.equal(existing.externalIdentity, '13')
  assert.deepEqual(await bindExisting(13).then((result) => 'id' in result && result.id), existing.id)
  const synced = await db
    .select({ remoteId: gitRepository.remote_repository_id })
    .from(gitRepository)
    .where(eq(gitRepository.connection_id, existing.id))
  assert.deepEqual(synced, [{ remoteId: '13' }])
  const linked = await service.listConnections(actor, context.teamId)
  assert.equal(
    linked.some((item) => item.externalIdentity === '14' || item.externalIdentity === '99'),
    false,
  )
})
