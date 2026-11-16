import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createTestApp } from '../support/create-test-app.ts'

test('知识资产接口未登录时返回统一 UNAUTHENTICATED 信封', { timeout: 30_000 }, async (t) => {
  const app = createTestApp()
  t.after(() => app.close())
  const teamId = '00000000-0000-0000-0000-000000000001'
  const requests: Array<{ method: 'GET' | 'POST'; url: string; payload?: object }> = [
    { method: 'GET', url: `/api/v1/teams/${teamId}/skills` },
    {
      method: 'POST',
      url: `/api/v1/teams/${teamId}/skills`,
      payload: {
        name: '代码评审',
        identifier: 'code-review',
        category: 'engineering',
        contentVersion: '1.0.0',
        summary: '简述',
        content: '指令',
      },
    },
    { method: 'GET', url: '/api/v1/skills/00000000-0000-0000-0000-000000000002' },
  ]
  const responses = await Promise.all(requests.map((request) => app.inject(request)))
  for (const response of responses) {
    assert.equal(response.statusCode, 200, response.body)
    const body = response.json()
    assert.equal(body.success, false)
    assert.equal(body.code, 'UNAUTHENTICATED')
    assert.ok(typeof body.requestId === 'string' && body.requestId.length > 0)
  }
})

test('已下线的模板目录、项目选用与快照接口返回 NOT_FOUND', { timeout: 30_000 }, async (t) => {
  const app = createTestApp()
  t.after(() => app.close())
  const id = '00000000-0000-0000-0000-000000000001'
  const responses = await Promise.all([
    app.inject({ method: 'GET', url: `/api/v1/teams/${id}/agent-templates` }),
    app.inject({ method: 'GET', url: `/api/v1/projects/${id}/agent-template` }),
    app.inject({ method: 'GET', url: '/api/v1/template-snapshot-links/old-link' }),
  ])
  for (const response of responses) {
    assert.equal(response.statusCode, 200, response.body)
    assert.equal(response.json().code, 'NOT_FOUND')
  }
})
