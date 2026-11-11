import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createApiClient, RequestError } from '../src/index.ts'

function success(data: unknown): Response {
  return Response.json({ success: true, code: 'OK', message: '成功', requestId: 'trace', data })
}

test('业务客户端构建路径、查询、POST 与幂等键', async () => {
  const teamId = '11111111-1111-4111-8111-111111111111'
  const projectId = '22222222-2222-4222-8222-222222222222'
  const calls: Array<{ url: string; init: RequestInit }> = []
  const client = createApiClient({
    baseUrl: 'https://example.test',
    fetch: async (input, init) => {
      calls.push({ url: String(input), init: init ?? {} })
      if (String(input).includes('/teams/team-1/projects')) {
        return success({
          id: projectId,
          teamId,
          name: '项目',
          description: null,
          owner: { userId: teamId, name: '负责人', status: 'active', available: true },
          status: 'active',
          counts: { openRequirements: 0, openBugs: 0 },
          version: 1,
          createdAt: '2026-11-10T00:00:00.000Z',
          updatedAt: '2026-11-10T00:00:00.000Z',
        })
      }
      if (String(input).includes('/requirements?status=')) {
        return success({ items: [], page: 2, pageSize: 20, total: 0 })
      }
      return success({
        teams: [
          {
            id: teamId,
            name: '团队',
            iconText: null,
            description: null,
            version: 1,
            role: 'admin',
            status: 'active',
          },
        ],
        isPlatformAdmin: false,
      })
    },
  })

  const teams = await client.listMyTeams()
  assert.equal(teams.data.teams[0]?.id, teamId)
  assert.equal(teams.data.isPlatformAdmin, false)
  assert.equal(calls[0]?.url, 'https://example.test/api/v1/me/teams')
  assert.equal(calls[0]?.init.method, 'GET')

  const project = await client.createProject('team-1', { name: '项目' }, { idempotencyKey: 'key-1' })
  assert.equal(project.data.id, projectId)
  assert.equal(calls[1]?.url, 'https://example.test/api/v1/teams/team-1/projects')
  assert.equal(calls[1]?.init.method, 'POST')
  assert.deepEqual(JSON.parse(String(calls[1]?.init.body)), { name: '项目' })
  assert.equal((calls[1]?.init.headers as Record<string, string>)['idempotency-key'], 'key-1')

  await client.listRequirements('project-1', { status: 'pending', page: 2, pageSize: 20 })
  assert.equal(
    calls[2]?.url,
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
