import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  asRecord,
  arrayField,
  createNode,
  expectSuccess,
  injectJson,
  setupPipelineContext,
  stringField,
} from './pipeline-harness.ts'

test('Agent 注册成功后节点视图保留请求上报的 os/arch 与版本', async (t) => {
  const context = await setupPipelineContext(t)
  const created = await createNode(context, context.admin)
  assert.ok(created.registrationToken)
  const registrationToken = created.registrationToken
  if (!registrationToken) return

  const registered = await injectJson(context.app, 'POST', '/api/v1/agent/register', {
    payload: {
      registrationToken,
      name: 'dev-machine',
      os: 'darwin',
      arch: 'arm64',
      capabilities: ['linux', 'docker', 'node24'],
      agentVersion: '0.1.0',
    },
  })
  const data = expectSuccess(registered, 'Agent 注册')
  assert.equal(stringField(data, 'nodeId'), created.nodeId)

  const list = await injectJson(context.app, 'GET', `/api/v1/teams/${context.teamId}/pipeline-nodes`, {
    cookie: context.admin.cookie,
  })
  const listData = expectSuccess(list, '节点列表')
  const nodes = arrayField(listData, 'items')
  const node = asRecord(
    nodes.find((item) => asRecord(item, '节点视图').nodeId === created.nodeId),
    '注册后的节点视图',
  )
  assert.equal(node.os, 'darwin')
  assert.equal(node.arch, 'arm64')
  assert.equal(node.status, 'online')
  assert.equal(node.agentVersion, '0.1.0')
  assert.equal(typeof node.lastHeartbeatAt, 'string')
})
