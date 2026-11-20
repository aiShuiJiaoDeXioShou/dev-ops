import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  asRecord,
  arrayField,
  createNode,
  expectFailure,
  expectSuccess,
  injectJson,
  setupPipelineContext,
  stringField,
} from './pipeline-harness.ts'

test('原生执行节点拒绝 Linux 注册，macOS 注册后显示能力、架构和版本', async (t) => {
  const context = await setupPipelineContext(t)
  const capabilities = ['macmini-deploy']
  const created = await createNode(context, context.admin, { capabilities })
  assert.ok(created.registrationToken)
  const payload = {
    registrationToken: created.registrationToken,
    name: 'dev-machine',
    os: 'darwin',
    arch: 'arm64',
    capabilities,
    agentVersion: '0.1.0',
  }

  const wrongOs = await injectJson(context.app, 'POST', '/api/v1/agent/register', {
    payload: { ...payload, os: 'linux' },
  })
  expectFailure(wrongOs, 'VALIDATION_ERROR', '原生节点拒绝 Linux 注册')
  const registered = await injectJson(context.app, 'POST', '/api/v1/agent/register', { payload })
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
  assert.deepEqual(node.capabilities, capabilities)
  assert.equal(node.os, 'darwin')
  assert.equal(node.arch, 'arm64')
  assert.equal(node.status, 'online')
  assert.equal(node.agentVersion, '0.1.0')
  assert.equal(typeof node.lastHeartbeatAt, 'string')
})
