import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createTestApp } from '../support/create-test-app.ts'

test('未登录访问需求接口返回 UNAUTHENTICATED', async (t) => {
  const app = createTestApp()
  t.after(() => app.close())
  const projectId = '00000000-0000-0000-0000-000000000000'
  const requirementId = '00000000-0000-0000-0000-000000000000'
  const responses = await Promise.all([
    app.inject({ method: 'GET', url: `/api/v1/projects/${projectId}/requirements` }),
    app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/requirements`,
      payload: { title: '需求', contentMode: 'markdown', contentMarkdown: 'x' },
    }),
    app.inject({ method: 'GET', url: `/api/v1/requirements/${requirementId}` }),
    app.inject({ method: 'GET', url: `/api/v1/requirements/${requirementId}/comments` }),
    app.inject({ method: 'GET', url: `/api/v1/requirements/${requirementId}/activities` }),
  ])
  for (const response of responses) {
    assert.equal(response.statusCode, 200)
    assert.equal(response.json().success, false)
    assert.equal(response.json().code, 'UNAUTHENTICATED')
  }
})
