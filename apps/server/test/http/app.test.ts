import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Type } from 'typebox'
import { createHttpApp } from '../../src/bootstrap/create-http-app.js'
import { loadConfig } from '../../src/platform/config/env.js'

const databaseUrl = 'postgresql://test_user:unit_test@127.0.0.1:1/dev_ops_test'
const testConfig = loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'silent', DATABASE_URL: databaseUrl, DB_CONNECT_TIMEOUT_MS: '100' })

test('health endpoint responds and generates its own request ID', async (t) => {
  const app = createHttpApp(testConfig)
  t.after(() => app.close())
  const response = await app.inject({
    method: 'GET', url: '/api/v1/health', headers: { 'x-request-id': 'untrusted-id' },
  })
  assert.equal(response.statusCode, 200)
  assert.deepEqual(response.json(), { status: 'ok' })
  assert.ok(response.headers['x-request-id'])
  assert.notEqual(response.headers['x-request-id'], 'untrusted-id')
})

test('unknown routes return the shared error format', async (t) => {
  const app = createHttpApp(testConfig)
  t.after(() => app.close())
  const response = await app.inject('/api/v1/missing')
  assert.equal(response.statusCode, 404)
  assert.deepEqual(response.json(), {
    code: 'NOT_FOUND', message: 'Route not found', requestId: response.headers['x-request-id'],
  })
})

test('unexpected errors do not expose internal messages', async (t) => {
  const app = createHttpApp(testConfig)
  t.after(() => app.close())
  app.get('/test-failure', async () => { throw new Error('private database credentials') })
  const response = await app.inject('/test-failure')
  assert.equal(response.statusCode, 500)
  assert.equal(response.json().code, 'INTERNAL_SERVER_ERROR')
  assert.equal(response.json().message, 'Internal server error')
  assert.equal(response.body.includes('private database credentials'), false)
})

test('route schemas validate input and serialize only declared output fields', async (t) => {
  const app = createHttpApp(testConfig)
  t.after(() => app.close())
  app.post('/test-validation', {
    schema: {
      body: Type.Object({ name: Type.String({ minLength: 1 }) }, { additionalProperties: false }),
      response: { 200: Type.Object({ name: Type.String() }) },
    },
  }, async (request) => ({ name: request.body.name, secret: 'must not escape' }))

  for (const payload of [{}, { name: '' }, { name: 'valid', extra: true }]) {
    const response = await app.inject({ method: 'POST', url: '/test-validation', payload })
    assert.equal(response.statusCode, 400)
    assert.equal(response.json().code, 'VALIDATION_ERROR')
  }

  const response = await app.inject({
    method: 'POST', url: '/test-validation', payload: { name: 'valid' },
  })
  assert.equal(response.statusCode, 200)
  assert.deepEqual(response.json(), { name: 'valid' })
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
  const app = createHttpApp(loadConfig({ NODE_ENV: 'production', LOG_LEVEL: 'silent', DATABASE_URL: databaseUrl }))
  t.after(() => app.close())
  assert.equal((await app.inject('/docs/json')).statusCode, 404)
  assert.equal((await app.inject('/api/v1/health')).statusCode, 200)
})


test('数据库故障返回 503，就绪响应不泄露凭据且存活接口仍成功', async (t) => {
  const app = createHttpApp(testConfig)
  t.after(() => app.close())
  const ready = await app.inject('/api/v1/ready')
  assert.equal(ready.statusCode, 503)
  assert.deepEqual(ready.json(), {
    code: 'DATABASE_UNAVAILABLE', message: '数据库暂不可用', requestId: ready.headers['x-request-id'],
  })
  assert.equal(ready.body.includes('unit_test'), false)
  assert.equal((await app.inject('/api/v1/health')).statusCode, 200)
})
