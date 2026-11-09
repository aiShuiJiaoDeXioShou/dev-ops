import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createApiClient, RequestError } from '../src/index.js'

test('从契约验证成功响应并筛除额外字段，保留请求标识', async () => {
  const client = createApiClient({
    baseUrl: 'https://example.test/proxy/',
    fetch: async (input) => {
      assert.equal(String(input), 'https://example.test/proxy/api/v1/ready')
      return Response.json({ status: 'ok', database: 'ok', private: 'hidden' }, { headers: { 'x-request-id': 'trace' } })
    },
  })
  assert.deepEqual(await client.ready(), { data: { status: 'ok', database: 'ok' }, requestId: 'trace' })
})

test('进程存活响应不能当成数据库就绪响应', async () => {
  const client = createApiClient({
    baseUrl: 'https://example.test', fetch: async () => Response.json({ status: 'ok' }),
  })
  assert.equal((await client.health()).data.status, 'ok')
  await assert.rejects(client.ready(), (error: unknown) => error instanceof RequestError && error.code === 'INVALID_RESPONSE')
})

test('错误响应校验保留来源代码，不向调用者透传服务端正文', async () => {
  for (const valid of [true, false]) {
    const client = createApiClient({
      baseUrl: 'https://example.test',
      fetch: async () => Response.json(valid
        ? { code: 'DATABASE_UNAVAILABLE', message: 'private credential', requestId: 'trace' }
        : { message: 'private credential' }, { status: 503 }),
    })
    await assert.rejects(client.ready(), (error: unknown) => {
      assert.ok(error instanceof RequestError)
      assert.equal(error.code, 'HTTP_ERROR')
      assert.equal(error.responseValid, valid)
      assert.equal(error.serverCode, valid ? 'DATABASE_UNAVAILABLE' : null)
      assert.equal(error.message.includes('private credential'), false)
      return true
    })
  }
})

test('无效配置在网络请求前被拒绝', () => {
  for (const baseUrl of ['invalid', 'file:///etc/passwd', 'https://user:secret@example.test', 'https://example.test?token=secret']) {
    assert.throws(() => createApiClient({ baseUrl }))
  }
  for (const timeoutMs of [0, -1, 1.5, 300_001]) {
    assert.throws(() => createApiClient({ baseUrl: 'https://example.test', timeoutMs }))
  }
})
