import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Type } from 'typebox'
import { createHttpApp } from '../../src/bootstrap/create-http-app.js'
import { loadConfig } from '../../src/platform/config/env.js'
import { ApiError } from '../../src/platform/http/errors.js'
import { ERROR_CODES } from '../../src/platform/http/error-codes.js'

const databaseUrl = 'postgresql://test_user:unit_test@127.0.0.1:1/dev_ops_test'
const testConfig = loadConfig({
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  DATABASE_URL: databaseUrl,
  DB_CONNECT_TIMEOUT_MS: '100',
  AUTH_SECRET: 'test-secret-at-least-32-characters-long',
})

test('health endpoint responds with the shared success envelope and its own request ID', async (t) => {
  const app = createHttpApp(testConfig)
  t.after(() => app.close())
  const response = await app.inject({
    method: 'GET',
    url: '/api/v1/health',
    headers: { 'x-request-id': 'untrusted-id' },
  })
  assert.equal(response.statusCode, 200)
  const body = response.json()
  assert.equal(body.success, true)
  assert.equal(body.code, 'OK')
  assert.equal(body.data.status, 'ok')
  assert.equal(body.requestId, response.headers['x-request-id'])
  assert.notEqual(body.requestId, 'untrusted-id')
})

test('unknown API routes return HTTP 200 with a NOT_FOUND failure envelope', async (t) => {
  const app = createHttpApp(testConfig)
  t.after(() => app.close())
  const response = await app.inject('/api/v1/missing')
  assert.equal(response.statusCode, 200)
  assert.deepEqual(response.json(), {
    success: false,
    code: 'NOT_FOUND',
    message: '接口不存在',
    requestId: response.headers['x-request-id'],
  })
})

test('unexpected errors return an internal error envelope without exposing details', async (t) => {
  const app = createHttpApp(testConfig)
  t.after(() => app.close())
  app.get('/test-failure', async () => {
    throw new Error('private database credentials')
  })
  const response = await app.inject('/test-failure')
  assert.equal(response.statusCode, 500)
  const body = response.json()
  assert.equal(body.success, false)
  assert.equal(body.code, 'INTERNAL_ERROR')
  assert.equal(body.message, '服务内部错误')
  assert.equal(response.body.includes('private database credentials'), false)
})

test('validation errors use HTTP 200 with VALIDATION_ERROR', async (t) => {
  const app = createHttpApp(testConfig)
  t.after(() => app.close())
  app.post(
    '/test-validation',
    {
      schema: {
        body: Type.Object({ name: Type.String({ minLength: 1 }) }, { additionalProperties: false }),
        response: { 200: Type.Object({ name: Type.String() }) },
      },
    },
    async (request) => ({ name: request.body.name, secret: 'must not escape' }),
  )

  for (const payload of [{}, { name: '' }, { name: 'valid', extra: true }]) {
    const response = await app.inject({ method: 'POST', url: '/test-validation', payload })
    assert.equal(response.statusCode, 200)
    const body = response.json()
    assert.equal(body.success, false)
    assert.equal(body.code, 'VALIDATION_ERROR')
  }

  const response = await app.inject({
    method: 'POST',
    url: '/test-validation',
    payload: { name: 'valid' },
  })
  assert.equal(response.statusCode, 200)
  assert.deepEqual(response.json(), { name: 'valid' })
})

test('ApiError is returned as HTTP 200 with its registered business code', async (t) => {
  const app = createHttpApp(testConfig)
  t.after(() => app.close())
  app.get('/test-business-error', async () => {
    throw new ApiError(ERROR_CODES.LAST_ADMIN_PROTECTED, '至少保留一位正常管理员')
  })
  const response = await app.inject('/test-business-error')
  assert.equal(response.statusCode, 200)
  assert.deepEqual(response.json(), {
    success: false,
    code: 'LAST_ADMIN_PROTECTED',
    message: '至少保留一位正常管理员',
    requestId: response.headers['x-request-id'],
  })
})

test('development documentation contains the health endpoint', async (t) => {
  const app = createHttpApp(testConfig)
  t.after(() => app.close())
  const response = await app.inject('/docs/json')
  assert.equal(response.statusCode, 200)
  assert.ok(response.json().paths['/api/v1/health'].get)
  assert.ok(response.json().paths['/api/v1/ready'].get)
  assert.equal((await app.inject('/docs/')).statusCode, 200)
})

test('production disables documentation by default', async (t) => {
  const app = createHttpApp(
    loadConfig({
      NODE_ENV: 'production',
      LOG_LEVEL: 'silent',
      DATABASE_URL: databaseUrl,
      AUTH_SECRET: 'test-secret-at-least-32-characters-long',
    }),
  )
  t.after(() => app.close())
  assert.equal((await app.inject('/docs/json')).statusCode, 404)
  assert.equal((await app.inject('/api/v1/health')).statusCode, 200)
})

test('就绪失败返回 HTTP 200 + 失败信封，存活接口不受影响', async (t) => {
  const app = createHttpApp(testConfig)
  t.after(() => app.close())
  const ready = await app.inject('/api/v1/ready')
  assert.equal(ready.statusCode, 200)
  assert.deepEqual(ready.json(), {
    success: false,
    code: 'DATABASE_UNAVAILABLE',
    message: '数据库暂不可用',
    requestId: ready.headers['x-request-id'],
  })
  assert.equal(ready.body.includes('unit_test'), false)
  assert.equal((await app.inject('/api/v1/health')).statusCode, 200)
})
