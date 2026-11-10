import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { createTestApp } from '../support/create-test-app.ts'

test('交付接口未登录返回 UNAUTHENTICATED，未知方法不进入业务路由', async (t) => {
  const app = createTestApp()
  t.after(() => app.close())
  await app.ready()

  const projectId = randomUUID()
  const buildId = randomUUID()
  const reportBody = {
    versionLabel: '1.0.0',
    source: 'pipeline',
    buildKey: 'ci-100',
    collectedAt: new Date().toISOString(),
    resultStatus: 'succeeded',
    note: '测试',
  }
  const cases = [
    { method: 'POST' as const, url: `/api/v1/projects/${projectId}/builds`, payload: reportBody },
    { method: 'GET' as const, url: `/api/v1/projects/${projectId}/builds` },
    { method: 'GET' as const, url: `/api/v1/builds/${buildId}` },
    { method: 'POST' as const, url: `/api/v1/builds/${buildId}/correct`, payload: { version: 1, reason: '原因' } },
    {
      method: 'POST' as const,
      url: `/api/v1/builds/${buildId}/artifacts`,
      payload: { artifactType: 'web_test_url', accessUrl: 'https://test.example.test' },
    },
    {
      method: 'POST' as const,
      url: `/api/v1/builds/${buildId}/targets`,
      payload: { targetType: 'requirement', targetId: randomUUID() },
    },
  ]
  for (const item of cases) {
    const response = await app.inject(item)
    assert.equal(response.statusCode, 200, response.body)
    assert.equal(response.json().success, false)
    assert.equal(response.json().code, 'UNAUTHENTICATED')
    assert.equal(typeof response.json().requestId, 'string')
  }

  const wrongMethod = await app.inject({ method: 'PUT', url: `/api/v1/builds/${buildId}`, payload: {} })
  assert.equal(wrongMethod.statusCode, 200)
  assert.equal(wrongMethod.json().code, 'NOT_FOUND')
})
