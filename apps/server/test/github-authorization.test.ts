import assert from 'node:assert/strict'
import { test } from 'node:test'
import { verifyGitHubInstallation } from '../src/adapters/git/github-authorization.ts'

const request = {
  clientId: 'test-app',
  clientSecret: 'test-secret',
  code: 'temporary-code',
  codeVerifier: 'verifier',
  redirectUri: 'https://devops.example.test/api/v1/git-authorizations/github/callback',
  installationId: 11,
}

test('GitHub 临时用户授权只核对指定安装与该用户可访问的仓库', async () => {
  const paths: string[] = []
  const result = await verifyGitHubInstallation({
    ...request,
    fetcher: async (input, init) => {
      const url = new URL(String(input))
      paths.push(`${url.host}${url.pathname}`)
      if (url.pathname === '/login/oauth/access_token') {
        assert.equal(init?.method, 'POST')
        assert.ok(init.body instanceof URLSearchParams)
        assert.equal(init.body.get('code_verifier'), request.codeVerifier)
        return Response.json({ access_token: 'temporary-user-token' })
      }
      assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer temporary-user-token')
      if (url.pathname === '/user/installations') {
        return Response.json({ installations: [{ id: 11, account: { login: 'test-org' } }] })
      }
      return Response.json({ repositories: [{ id: 23 }, { id: 24 }], total_count: 2 })
    },
  })
  assert.deepEqual(paths, [
    'github.com/login/oauth/access_token',
    'api.github.com/user/installations',
    'api.github.com/user/installations/11/repositories',
  ])
  assert.deepEqual(result, { login: 'test-org', repositoryIds: new Set(['23', '24']) })
})

test('安装不在当前用户授权列表时拒绝绑定', async () => {
  await assert.rejects(
    verifyGitHubInstallation({
      ...request,
      fetcher: async (input) => {
        if (String(input).includes('/oauth/access_token'))
          return Response.json({ access_token: 'temporary-user-token' })
        return Response.json({ installations: [{ id: 12, account: { login: 'other-org' } }] })
      },
    }),
    { code: 'auth_failed' },
  )
})
