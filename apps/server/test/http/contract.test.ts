import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createTestApp } from '../support/create-test-app.ts'
import { ERROR_CODES } from '../../src/platform/http/error-codes.ts'

test('注册路由只使用 GET/POST，统一错误码与 API 404 信封', async (t) => {
  const app = createTestApp()
  t.after(() => app.close())
  await app.ready()

  const routes = app.printRoutes({ commonPrefix: false })
  for (const method of ['PUT', 'PATCH', 'DELETE']) {
    assert.equal(new RegExp(`\\b${method}\\b`).test(routes), false, `不应注册 ${method} 路由`)
  }
  assert.match(routes, /GET/)
  assert.match(routes, /POST/)

  const codes = Object.values(ERROR_CODES)
  assert.equal(new Set(codes).size, codes.length, '业务错误码不得重复')
  for (const code of codes) assert.match(code, /^[A-Z][A-Z0-9_]*$/, `错误码格式不合法：${code}`)

  const notFound = await app.inject({ method: 'GET', url: '/api/v1/does-not-exist' })
  assert.equal(notFound.statusCode, 200)
  const body = notFound.json()
  assert.equal(body.success, false)
  assert.equal(body.code, 'NOT_FOUND')
  assert.equal(typeof body.requestId, 'string')

  const wrongMethod = await app.inject({ method: 'PUT', url: '/api/v1/health', payload: {} })
  assert.equal(wrongMethod.statusCode, 200)
  assert.equal(wrongMethod.json().success, false)
  assert.equal(wrongMethod.json().code, 'NOT_FOUND')
})
