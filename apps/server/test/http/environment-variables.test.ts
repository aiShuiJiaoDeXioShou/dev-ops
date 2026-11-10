import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { createConfigurationTestApp } from '../support/configuration-app.ts'

test('项目环境变量接口未登录返回 HTTP 200 + UNAUTHENTICATED 信封', async (t) => {
  const app = createConfigurationTestApp()
  t.after(() => app.close())
  const projectId = randomUUID()
  const variableId = randomUUID()
  const plaintext = 'plain-value-should-not-leak'
  const cases = [
    { method: 'GET' as const, url: `/api/v1/projects/${projectId}/environments/development/variables` },
    {
      method: 'POST' as const,
      url: `/api/v1/projects/${projectId}/environments/development/variables`,
      payload: { name: 'APP_NAME', kind: 'plain', value: plaintext },
    },
    {
      method: 'POST' as const,
      url: `/api/v1/project-variables/${variableId}/update`,
      payload: { version: 1, value: plaintext },
    },
    {
      method: 'POST' as const,
      url: `/api/v1/project-variables/${variableId}/remove`,
      payload: { reason: '清理' },
    },
  ]
  for (const item of cases) {
    const response = await app.inject(item)
    assert.equal(response.statusCode, 200, response.body)
    const body = response.json()
    assert.equal(body.success, false)
    assert.equal(body.code, 'UNAUTHENTICATED')
    assert.equal(typeof body.requestId, 'string')
    assert.ok(!response.body.includes(plaintext), '未登录响应不得包含请求中的明文')
  }
})

test('环境变量路由只注册 GET/POST，路径环境与变量名在入口被校验', async (t) => {
  const app = createConfigurationTestApp()
  t.after(() => app.close())
  const projectId = randomUUID()
  const variableId = randomUUID()

  const wrongMethods = [
    { method: 'PUT' as const, url: `/api/v1/project-variables/${variableId}`, payload: {} },
    { method: 'DELETE' as const, url: `/api/v1/project-variables/${variableId}` },
    { method: 'PATCH' as const, url: `/api/v1/projects/${projectId}/environments/test/variables`, payload: {} },
  ]
  for (const item of wrongMethods) {
    const response = await app.inject(item)
    assert.equal(response.statusCode, 200, response.body)
    assert.equal(response.json().code, 'NOT_FOUND')
  }

  const invalidResponses = [
    // 环境不属于 development/test/production，schema 在鉴权前拒绝。
    await app.inject({ method: 'GET', url: `/api/v1/projects/${projectId}/environments/staging/variables` }),
    await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/environments/development/variables`,
      payload: { name: 'APP_NAME', kind: 'unsupported', value: 'x' },
    }),
    await app.inject({
      method: 'POST',
      url: `/api/v1/project-variables/${variableId}/update`,
      payload: { version: 1, unknownField: 'x' },
    }),
  ]
  for (const response of invalidResponses) {
    assert.equal(response.statusCode, 200, response.body)
    assert.equal(response.json().success, false)
    assert.equal(response.json().code, 'VALIDATION_ERROR')
  }
})
