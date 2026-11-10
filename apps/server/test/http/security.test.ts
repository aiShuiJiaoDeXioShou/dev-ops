import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createTestApp } from '../support/create-test-app.ts'

test('错误响应不泄漏堆栈、SQL 或凭据，并保留请求标识', async (t) => {
  const app = createTestApp()
  t.after(() => app.close())

  const notFound = await app.inject({ method: 'GET', url: '/api/v1/secret-admin' })
  assert.equal(notFound.statusCode, 200)
  assert.equal(notFound.json().code, 'NOT_FOUND')
  assert.equal(typeof notFound.headers['x-request-id'], 'string')

  const invalidBody = await app.inject({
    method: 'POST',
    url: '/api/v1/platform/teams',
    payload: { name: '', adminEmail: 'not-an-email' },
  })
  assert.equal(invalidBody.statusCode, 200)
  const body = invalidBody.json()
  assert.equal(body.success, false)
  const serialized = JSON.stringify(body)
  for (const forbidden of ['stack', 'SELECT ', 'password', 'secret', 'ciphertext', 'postgresql://']) {
    assert.equal(serialized.toLowerCase().includes(forbidden.toLowerCase()), false, `响应不得包含 ${forbidden}`)
  }
  assert.deepEqual(
    Object.keys(body).sort(),
    ['code', 'data', 'message', 'requestId', 'success'].filter((key) => key in body).sort(),
  )

  const blockedSignup = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/sign-up/email',
    payload: { email: 'blocked@example.test', password: 'password-123', name: 'blocked' },
  })
  assert.equal(blockedSignup.statusCode, 404)
  assert.equal(JSON.stringify(blockedSignup.json()).includes('stack'), false)

  const wrongMethod = await app.inject({ method: 'DELETE', url: '/api/v1/health' })
  assert.equal(wrongMethod.statusCode, 200)
  assert.equal(wrongMethod.json().code, 'NOT_FOUND')
})
