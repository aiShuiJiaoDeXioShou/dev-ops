import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createTestApp } from '../support/create-test-app.js'

test('未登录访问需求流程接口返回 UNAUTHENTICATED', async (t) => {
  const app = createTestApp()
  t.after(() => app.close())
  const id = '00000000-0000-0000-0000-000000000000'
  const bodies: Record<string, Record<string, unknown>> = {
    'start-development': { version: 1 },
    'submit-test': { version: 1, testOwnerUserId: id, scopeNote: '范围', selfTestResult: 'passed' },
    'start-test': { version: 1 },
    'withdraw-test': { version: 1, reason: '原因' },
    'return-to-development': { version: 1, reason: '原因' },
    'pass-test': { version: 1, conclusion: '结论' },
    'reopen-development': { version: 1, reason: '原因' },
    cancel: { version: 1, reason: '原因' },
    restore: { version: 1, reason: '原因' },
  }
  for (const [path, body] of Object.entries(bodies)) {
    const response = await app.inject({ method: 'POST', url: `/api/v1/requirements/${id}/${path}`, payload: body })
    assert.equal(response.statusCode, 200, path)
    assert.equal(response.json().code, 'UNAUTHENTICATED', path)
  }
  const eligibility = await app.inject(`/api/v1/requirements/${id}/test-pass-eligibility`)
  assert.equal(eligibility.json().code, 'UNAUTHENTICATED')
  const submissions = await app.inject(`/api/v1/requirements/${id}/test-submissions`)
  assert.equal(submissions.json().code, 'UNAUTHENTICATED')
})
