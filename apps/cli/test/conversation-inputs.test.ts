import type { ApiSuccessData } from '@dev-ops/api-client'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { runCli } from '../src/cli.ts'
import { failureEnvelope, startStubServer, successEnvelope } from './support/stub-server.ts'

async function execute(server: string, args: string[]) {
  let stdout = ''
  let stderr = ''
  const code = await runCli(['conversation', ...args, '--json'], {
    version: '0.10.0',
    env: { DEV_OPS_SERVER: server, DEV_OPS_TOKEN: 'devops_pat_fixture' },
    stdout: (value) => {
      stdout += value
    },
    stderr: (value) => {
      stderr += value
    },
  })
  return { code, stdout, stderr }
}

test('会话用量和本人排队消息使用读取接口，输出完整 JSON 数据', async (t) => {
  const conversationId = randomUUID()
  const messageId = randomUUID()
  const usage = { contexts: [], inputTokens: 120, outputTokens: 30, costUsd: 0.001 } satisfies ApiSuccessData<
    '/api/v1/bot-conversations/{conversationId}/usage',
    'get'
  >
  const inputs = {
    items: [
      {
        messageId,
        text: '下一步检查',
        mode: 'follow_up',
        attachmentIds: [],
        attachments: [],
        skillIds: [],
        mentionBotIds: [],
        mentionAll: false,
      },
    ],
  } satisfies ApiSuccessData<'/api/v1/bot-conversations/{conversationId}/queued-inputs', 'get'>
  const paths: string[] = []
  const server = await startStubServer(t, (req, res) => {
    assert.equal(req.method, 'GET')
    assert.equal(req.headers.authorization, 'Bearer devops_pat_fixture')
    paths.push(req.url ?? '')
    res.setHeader('content-type', 'application/json')
    res.end(successEnvelope(req.url?.endsWith('/usage') ? usage : inputs))
  })
  const first = await execute(server, ['usage', conversationId])
  const second = await execute(server, ['queued-inputs', conversationId])
  assert.equal(first.code, 0, first.stderr)
  assert.equal(second.code, 0, second.stderr)
  assert.deepEqual(JSON.parse(first.stdout).data, usage)
  assert.deepEqual(JSON.parse(second.stdout).data, inputs)
  assert.deepEqual(paths, [
    `/api/v1/bot-conversations/${conversationId}/usage`,
    `/api/v1/bot-conversations/${conversationId}/queued-inputs`,
  ])
})

test('撤回排队消息携带幂等键并返回原稿；已领取时保留服务端失败码', async (t) => {
  const conversationId = randomUUID()
  const messageId = randomUUID()
  let requests = 0
  const draft = {
    messageId,
    text: '保留我的原稿',
    mode: 'steer',
    attachmentIds: [],
    attachments: [],
    skillIds: [],
    mentionBotIds: [],
    mentionAll: false,
  } satisfies ApiSuccessData<'/api/v1/bot-conversations/{conversationId}/messages/{messageId}/withdraw', 'post'>
  const server = await startStubServer(t, (req, res) => {
    requests += 1
    assert.equal(req.method, 'POST')
    assert.equal(req.url, `/api/v1/bot-conversations/${conversationId}/messages/${messageId}/withdraw`)
    assert.match(String(req.headers['idempotency-key']), /^[0-9a-f-]{36}$/u)
    res.setHeader('content-type', 'application/json')
    res.end(requests === 1 ? successEnvelope(draft) : failureEnvelope('BOT_RUN_STATE_CONFLICT', '消息已被领取'))
  })
  const args = ['withdraw-input', conversationId, messageId, '--yes']
  const success = await execute(server, args)
  assert.equal(success.code, 0, success.stderr)
  assert.deepEqual(JSON.parse(success.stdout).data, draft)
  const failed = await execute(server, args)
  assert.equal(failed.code, 1)
  assert.equal(failed.stdout, '')
  assert.equal(JSON.parse(failed.stderr).code, 'BOT_RUN_STATE_CONFLICT')
})

test('缺少会话或消息标识、空标识及未确认撤回时不发送请求', async (t) => {
  let requests = 0
  const server = await startStubServer(t, (_req, res) => {
    requests += 1
    res.end(successEnvelope({}))
  })
  for (const args of [
    ['usage'],
    ['queued-inputs'],
    ['usage', ' '],
    ['queued-inputs', ' '],
    ['withdraw-input', randomUUID()],
    ['withdraw-input', randomUUID(), '', '--yes'],
    ['withdraw-input', randomUUID(), randomUUID()],
    ['usage', randomUUID(), '--unknown'],
  ]) {
    const result = await execute(server, args)
    assert.equal(result.code, 2, result.stderr)
    assert.equal(result.stdout, '')
  }
  assert.equal(requests, 0)
})

test('会话读取网络失败以退出码1报告且不输出成功数据', async (t) => {
  const server = await startStubServer(t, (req) => {
    req.socket.destroy()
  })
  const result = await execute(server, ['usage', randomUUID()])
  assert.equal(result.code, 1)
  assert.equal(result.stdout, '')
  assert.equal(JSON.parse(result.stderr).success, false)
})
