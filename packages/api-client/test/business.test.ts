import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createApiClient, RequestError } from '../src/index.js'

function success(data: unknown): Response {
  return Response.json({ success: true, code: 'OK', message: '成功', requestId: 'trace', data })
}

test('业务客户端构建路径、查询、POST 与幂等键', async () => {
  const calls: Array<{ url: string; init: RequestInit }> = []
  const client = createApiClient({
    baseUrl: 'https://example.test',
    fetch: async (input, init) => {
      calls.push({ url: String(input), init: init ?? {} })
      if (String(input).includes('/requirements/req-1/submit-test')) {
        return success({ requirement: { id: 'req-1' }, submission: { id: 'sub-1' }, activityId: 'act-1' })
      }
      if (String(input).includes('/teams/team-1/projects')) {
        return success({ id: 'project-1', name: '项目' })
      }
      return success([{ id: 'team-1', name: '团队', role: 'admin', status: 'active' }])
    },
  })

  const teams = await client.listMyTeams()
  assert.equal(teams.data[0]?.id, 'team-1')
  assert.equal(calls[0]?.url, 'https://example.test/api/v1/me/teams')
  assert.equal(calls[0]?.init.method, 'GET')

  const project = await client.createProject('team-1', { name: '项目' })
  assert.equal(project.data.id, 'project-1')
  assert.equal(calls[1]?.url, 'https://example.test/api/v1/teams/team-1/projects')
  assert.equal(calls[1]?.init.method, 'POST')
  assert.deepEqual(JSON.parse(String(calls[1]?.init.body)), { name: '项目' })

  const submitted = await client.submitRequirementTest(
    'req-1',
    { version: 2, testOwnerUserId: 'user-2', scopeNote: '范围', selfTestResult: 'passed' },
    { idempotencyKey: 'key-1' },
  )
  assert.equal(submitted.data.activityId, 'act-1')
  assert.equal((calls[2]?.init.headers as Record<string, string>)['idempotency-key'], 'key-1')

  await client.listRequirements('project-1', { status: 'pending', page: 2, pageSize: 20 })
  assert.equal(
    calls[3]?.url,
    'https://example.test/api/v1/projects/project-1/requirements?status=pending&page=2&pageSize=20',
  )
})

test('业务失败信封转换为带业务码的 RequestError', async () => {
  const client = createApiClient({
    baseUrl: 'https://example.test',
    fetch: async () =>
      Response.json({
        success: false,
        code: 'PRECONDITION_FAILED',
        message: '内部原因',
        requestId: 'trace-2',
        data: { blockers: [] },
      }),
  })
  await assert.rejects(client.getProject('project-1'), (error: unknown) => {
    return (
      error instanceof RequestError &&
      error.code === 'BUSINESS_ERROR' &&
      error.serverCode === 'PRECONDITION_FAILED' &&
      error.requestId === 'trace-2'
    )
  })
})
