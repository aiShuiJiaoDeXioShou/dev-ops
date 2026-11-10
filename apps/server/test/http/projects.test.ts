import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createTestApp } from '../support/create-test-app.ts'

test('未登录访问项目接口返回 UNAUTHENTICATED', async (t) => {
  const app = createTestApp()
  t.after(() => app.close())
  const teamId = '00000000-0000-0000-0000-000000000000'
  for (const [method, url, payload] of [
    ['GET', `/api/v1/teams/${teamId}/projects`, undefined],
    ['POST', `/api/v1/teams/${teamId}/projects`, { name: '项目' }],
    ['GET', '/api/v1/projects/00000000-0000-0000-0000-000000000000', undefined],
    ['POST', '/api/v1/projects/00000000-0000-0000-0000-000000000000/update', { version: 1 }],
    ['GET', '/api/v1/projects/00000000-0000-0000-0000-000000000000/stats', undefined],
  ] as const) {
    const response = await app.inject({ method, url, ...(payload ? { payload } : {}) })
    assert.equal(response.statusCode, 200)
    assert.equal(response.json().success, false)
    assert.equal(response.json().code, 'UNAUTHENTICATED')
  }
})
