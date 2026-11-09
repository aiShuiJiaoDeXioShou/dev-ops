import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createTestApp } from '../support/create-test-app.js'

test('未登录访问仓库与代码引用接口返回 UNAUTHENTICATED', async (t) => {
  const app = createTestApp()
  t.after(() => app.close())
  const projectId = '00000000-0000-0000-0000-000000000000'
  const responses = await Promise.all([
    app.inject({ method: 'GET', url: `/api/v1/projects/${projectId}/repositories` }),
    app.inject({ method: 'GET', url: `/api/v1/projects/${projectId}/repositories/available` }),
    app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/repositories`,
      payload: { repositoryId: projectId },
    }),
    app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/code-references`,
      payload: {
        targetType: 'requirement',
        targetId: projectId,
        repositoryId: projectId,
        objectType: 'issue',
        remoteId: '1',
      },
    }),
    app.inject({ method: 'POST', url: `/api/v1/code-references/${projectId}/refresh` }),
  ])
  for (const response of responses) {
    assert.equal(response.statusCode, 200)
    assert.equal(response.json().success, false)
    assert.equal(response.json().code, 'UNAUTHENTICATED')
  }
})
