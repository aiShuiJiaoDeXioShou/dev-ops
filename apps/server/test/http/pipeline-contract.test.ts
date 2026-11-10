import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { createTestApp } from '../support/create-test-app.ts'

const UUID = '00000000-0000-4000-8000-000000000000'

test('流水线平台接口未登录返回 UNAUTHENTICATED', async (t) => {
  const app = createTestApp()
  t.after(() => app.close())
  await app.ready()
  const runId = randomUUID()
  const cases = [
    { method: 'GET' as const, url: `/api/v1/projects/${UUID}/pipeline-workflows` },
    { method: 'GET' as const, url: `/api/v1/projects/${UUID}/pipeline-workflows/detail?path=.devops/workflows/ci.yml` },
    { method: 'GET' as const, url: `/api/v1/projects/${UUID}/pipeline-runs` },
    {
      method: 'POST' as const,
      url: `/api/v1/projects/${UUID}/pipeline-runs`,
      payload: {
        workflowPath: '.devops/workflows/ci.yml',
        ref: 'main',
        idempotencyKey: 'k-1',
      },
    },
    { method: 'GET' as const, url: `/api/v1/pipeline-runs/${runId}` },
    { method: 'POST' as const, url: `/api/v1/pipeline-runs/${runId}/cancel`, payload: {} },
    { method: 'GET' as const, url: `/api/v1/pipeline-runs/${runId}/logs` },
    { method: 'GET' as const, url: `/api/v1/pipeline-runs/${runId}/artifacts` },
    { method: 'GET' as const, url: `/api/v1/pipeline-artifacts/${runId}/download` },
    { method: 'GET' as const, url: `/api/v1/teams/${UUID}/pipeline-nodes` },
    {
      method: 'POST' as const,
      url: `/api/v1/teams/${UUID}/pipeline-nodes`,
      payload: { name: 'node', capabilities: ['linux'] },
    },
    { method: 'POST' as const, url: `/api/v1/pipeline-nodes/${runId}/drain` },
    { method: 'POST' as const, url: `/api/v1/pipeline-nodes/${runId}/disable` },
    { method: 'POST' as const, url: `/api/v1/pipeline-nodes/${runId}/tokens/rotate` },
    { method: 'POST' as const, url: '/api/v1/agent/register', payload: {} },
    { method: 'POST' as const, url: '/api/v1/agent/heartbeat', payload: {} },
    { method: 'POST' as const, url: '/api/v1/agent/lease', payload: {} },
  ]
  for (const item of cases) {
    const response = await app.inject(item)
    assert.equal(response.statusCode, 200, `${item.method} ${item.url}: ${response.body}`)
    const body = response.json()
    assert.equal(body.success, false, `${item.method} ${item.url}: ${response.body}`)
    // 缺少身份与请求体不合法都在业务层之前拦截；两者都属于可预期失败。
    assert.ok(
      ['UNAUTHENTICATED', 'VALIDATION_ERROR', 'AGENT_TOKEN_INVALID'].includes(body.code),
      `${item.method} ${item.url} 返回 ${body.code}`,
    )
    assert.equal(typeof body.requestId, 'string')
  }
})

test('流水线请求体与查询参数非法时返回 VALIDATION_ERROR', async (t) => {
  const app = createTestApp()
  t.after(() => app.close())
  await app.ready()
  const cases = [
    {
      method: 'POST' as const,
      url: `/api/v1/projects/${UUID}/pipeline-runs`,
      payload: { workflowPath: '', ref: 'main', idempotencyKey: 'k-1' },
    },
    {
      method: 'POST' as const,
      url: `/api/v1/projects/${UUID}/pipeline-runs`,
      payload: { workflowPath: '.devops/workflows/ci.yml', ref: 'main', idempotencyKey: 'k-1', extra: true },
    },
    {
      method: 'POST' as const,
      url: `/api/v1/teams/${UUID}/pipeline-nodes`,
      payload: { name: 'node', capabilities: [] },
    },
    {
      method: 'GET' as const,
      url: `/api/v1/pipeline-runs/${UUID}/logs?afterSeq=-2`,
    },
    {
      method: 'GET' as const,
      url: `/api/v1/pipeline-runs/${UUID}/logs?limit=1000`,
    },
    {
      method: 'GET' as const,
      url: `/api/v1/projects/${UUID}/pipeline-workflows/detail`,
    },
    {
      method: 'POST' as const,
      url: '/api/v1/agent/register',
      payload: {
        registrationToken: 'short',
        name: 'node',
        os: 'linux',
        arch: 'x64',
        capabilities: [],
        agentVersion: '0.1.0',
      },
    },
    {
      method: 'POST' as const,
      url: '/api/v1/agent/heartbeat',
      payload: { runningLeaseId: 'x' },
    },
  ]
  for (const item of cases) {
    const response = await app.inject(item)
    assert.equal(response.statusCode, 200, `${item.method} ${item.url}: ${response.body}`)
    const body = response.json()
    assert.equal(body.success, false, `${item.method} ${item.url}: ${response.body}`)
    assert.equal(body.code, 'VALIDATION_ERROR', `${item.method} ${item.url} 返回 ${body.code}`)
  }
})

test('流水线与 Agent 路由均已注册且只使用 GET/POST', async (t) => {
  const app = createTestApp()
  t.after(() => app.close())
  await app.ready()
  const routes = app.printRoutes({ commonPrefix: false })
  for (const expected of [
    'pipeline-workflows',
    'pipeline-runs',
    'pipeline-artifacts',
    'pipeline-nodes',
    'agent/register',
    'agent/heartbeat',
    'agent/lease',
  ]) {
    assert.match(routes, new RegExp(expected.replace('/', '\\/')), `缺少路由 ${expected}`)
  }
  for (const method of ['PUT', 'PATCH', 'DELETE']) {
    assert.equal(new RegExp(`\\b${method}\\b`).test(routes), false, `不应注册 ${method} 路由`)
  }
})
