import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createTestApp } from '../support/create-test-app.ts'

test('认证端点已挂载，浏览器自助注册被拒绝', async (t) => {
  const app = createTestApp()
  t.after(() => app.close())
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/sign-up/email',
    payload: { email: 'blocked@example.test', password: 'password-123', name: 'blocked' },
  })
  assert.equal(response.statusCode, 404)
  const body = response.json()
  assert.equal(body.success, false)
  assert.equal(body.code, 'NOT_FOUND')
})
