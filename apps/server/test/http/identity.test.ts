import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createTestApp } from '../support/create-test-app.js'

test('未登录访问团队接口返回 HTTP 200 + UNAUTHENTICATED 业务错误', async (t) => {
  const app = createTestApp()
  t.after(() => app.close())
  for (const url of ['/api/v1/me/teams', '/api/v1/teams/00000000-0000-0000-0000-000000000000/members']) {
    const response = await app.inject(url)
    assert.equal(response.statusCode, 200)
    const body = response.json()
    assert.equal(body.success, false)
    assert.equal(body.code, 'UNAUTHENTICATED')
  }
  const createTeam = await app.inject({
    method: 'POST',
    url: '/api/v1/platform/teams',
    payload: { name: 'team', adminEmail: 'admin@example.test' },
  })
  assert.equal(createTeam.statusCode, 200)
  assert.equal(createTeam.json().code, 'UNAUTHENTICATED')
})
