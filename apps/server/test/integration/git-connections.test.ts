import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import { eq } from 'drizzle-orm'
import { gitRepository } from '../../src/modules/code/code.tables.ts'
import { createIntegrationsService } from '../../src/modules/integrations/integrations.service.ts'
import { loadConfig } from '../../src/platform/config/env.ts'
import { ApiError } from '../../src/platform/http/errors.ts'
import { setupPipelineContext } from './pipeline-harness.ts'

test('GitHub App 多安装绑定、用户授权范围与重复授权', { timeout: 90_000 }, async (t) => {
  const context = await setupPipelineContext(t)
  const db = context.app.db
  const actor = { id: context.admin.userId, name: '团队管理员', email: 'admin@example.test' }
  const developer = { id: context.developer.userId, name: '开发者', email: 'developer@example.test' }
  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: context.runtimeUrl,
    AUTH_SECRET: 'test-auth-secret-at-least-32-characters',
    GITHUB_AUTH_MODE: 'app',
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

  async function startAuthorization(installationId: number, code: string) {
    const pending = await requestConnection()
    assert.ok('authorizationUrl' in pending)
    const installUrl = new URL(pending.authorizationUrl)
    assert.equal(installUrl.pathname, '/apps/devops-test/installations/new')
    const state = installUrl.searchParams.get('state')
    assert.ok(state)
    await assert.rejects(() => service.completeAuthorization(developer, 'github', { state, installationId }), denied)
    const authorization = await service.completeAuthorization(actor, 'github', { state, installationId })
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
  const second = await service.completeAuthorization(actor, 'github', await startAuthorization(12, 'second'))
  assert.ok('id' in second)
  assert.notEqual(second.id, first.id)
  const projectRepositories = () =>
    db.select({ id: gitRepository.id }).from(gitRepository).where(eq(gitRepository.connection_id, first.id))
  const previous = await projectRepositories()
  assert.equal(previous.length, 1)
  const renewed = await service.completeAuthorization(actor, 'github', await startAuthorization(11, 'renew'))
  assert.ok('id' in renewed)
  assert.equal(renewed.id, first.id)
  assert.deepEqual(await projectRepositories(), previous)
  const appConnections = (await service.listConnections(actor, context.teamId)).filter(
    (row) => row.authKind === 'github_app_installation',
  )
  assert.equal(appConnections.length, 2)
})
