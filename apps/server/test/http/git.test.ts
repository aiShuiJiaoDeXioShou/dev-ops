import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createTestApp } from '../support/create-test-app.js'

test('未登录访问 Git 集成接口返回 UNAUTHENTICATED', async (t) => {
  const app = createTestApp()
  t.after(() => app.close())
  const teamId = '00000000-0000-0000-0000-000000000000'
  const connectionId = '00000000-0000-0000-0000-000000000000'
  const responses = await Promise.all([
    app.inject({ method: 'GET', url: '/api/v1/git-providers' }),
    app.inject({ method: 'GET', url: `/api/v1/teams/${teamId}/git-connections` }),
    app.inject({
      method: 'POST',
      url: `/api/v1/teams/${teamId}/git-connections`,
      payload: { providerKey: 'gitea', name: 'Gitea', instanceUrl: 'https://gitea.example.test', token: 'token' },
    }),
    app.inject({ method: 'POST', url: `/api/v1/git-connections/${connectionId}/check` }),
    app.inject({ method: 'POST', url: `/api/v1/git-connections/${connectionId}/sync-repositories` }),
    app.inject({ method: 'GET', url: `/api/v1/git-connections/${connectionId}/repositories` }),
  ])
  for (const response of responses) {
    assert.equal(response.statusCode, 200)
    assert.equal(response.json().success, false)
    assert.equal(response.json().code, 'UNAUTHENTICATED')
  }
})
