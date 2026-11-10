import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { createConfigurationTestApp } from '../support/configuration-app.ts'

test('凭据接口未登录返回 HTTP 200 + UNAUTHENTICATED 信封，且不回显明文', async (t) => {
  const app = createConfigurationTestApp()
  t.after(() => app.close())
  const teamId = randomUUID()
  const credentialId = randomUUID()
  const plaintext = 'sk-live-should-never-leak-0001'
  const cases = [
    { method: 'GET' as const, url: `/api/v1/teams/${teamId}/credentials` },
    { method: 'GET' as const, url: `/api/v1/teams/${teamId}/credentials/${credentialId}` },
    {
      method: 'POST' as const,
      url: `/api/v1/teams/${teamId}/credentials`,
      payload: { name: '生产密钥', kind: 'api_key', value: plaintext },
    },
    {
      method: 'POST' as const,
      url: `/api/v1/credentials/${credentialId}/rotate`,
      payload: { value: plaintext },
    },
    {
      method: 'POST' as const,
      url: `/api/v1/credentials/${credentialId}/revoke`,
      payload: { reason: '安全事件' },
    },
    {
      method: 'POST' as const,
      url: `/api/v1/credentials/${credentialId}/grants`,
      payload: { projectId: randomUUID() },
    },
    {
      method: 'POST' as const,
      url: `/api/v1/credentials/${credentialId}/grants/${randomUUID()}/revoke`,
      payload: { reason: '项目结束' },
    },
    { method: 'GET' as const, url: `/api/v1/credentials/${credentialId}/usage` },
    {
      method: 'POST' as const,
      url: `/api/v1/credentials/${credentialId}/reveal-value`,
      payload: { password: 'guess-password-123' },
    },
  ]
  for (const item of cases) {
    const response = await app.inject(item)
    assert.equal(response.statusCode, 200, response.body)
    const body = response.json()
    assert.equal(body.success, false)
    assert.equal(body.code, 'UNAUTHENTICATED')
    assert.equal(typeof body.requestId, 'string')
    assert.equal(typeof body.message, 'string')
    assert.ok(!response.body.includes(plaintext), '未登录响应不得包含请求中的明文')
  }
})

test('凭据接口只注册 GET/POST；非法路径参数与未知字段被 schema 拒绝', async (t) => {
  const app = createConfigurationTestApp()
  t.after(() => app.close())
  const teamId = randomUUID()
  const credentialId = randomUUID()

  const wrongMethods = [
    { method: 'PUT' as const, url: `/api/v1/teams/${teamId}/credentials`, payload: {} },
    { method: 'PATCH' as const, url: `/api/v1/credentials/${credentialId}/rotate`, payload: {} },
    { method: 'DELETE' as const, url: `/api/v1/credentials/${credentialId}/grants/${randomUUID()}`, payload: {} },
    { method: 'DELETE' as const, url: `/api/v1/credentials/${credentialId}/usage` },
    { method: 'GET' as const, url: `/api/v1/credentials/${credentialId}/reveal-value` },
  ]
  for (const item of wrongMethods) {
    const response = await app.inject(item)
    assert.equal(response.statusCode, 200, response.body)
    assert.equal(response.json().code, 'NOT_FOUND')
  }

  const invalidResponses = [
    await app.inject({ method: 'GET', url: '/api/v1/teams/not-a-uuid/credentials' }),
    await app.inject({
      method: 'POST',
      url: `/api/v1/credentials/${credentialId}/rotate`,
      payload: { value: 'x', extraField: true },
    }),
    await app.inject({
      method: 'POST',
      url: `/api/v1/teams/${teamId}/credentials`,
      payload: { name: '密钥', kind: 'unsupported', value: 'x' },
    }),
    await app.inject({
      method: 'POST',
      url: `/api/v1/credentials/${credentialId}/reveal-value`,
      payload: {},
    }),
    await app.inject({
      method: 'POST',
      url: `/api/v1/credentials/${credentialId}/reveal-value`,
      payload: { password: 'x', remember: true },
    }),
  ]
  for (const response of invalidResponses) {
    assert.equal(response.statusCode, 200, response.body)
    assert.equal(response.json().success, false)
    assert.equal(response.json().code, 'VALIDATION_ERROR')
  }
})
