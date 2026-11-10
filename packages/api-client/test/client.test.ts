import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createApiClient, RequestError } from '../src/index.ts'

function successBody<T>(data: T) {
  return { success: true, code: 'OK', message: 'OK', requestId: 'trace', data }
}

test('从契约验证成功信封并筛除额外字段，保留请求标识', async () => {
  const client = createApiClient({
    baseUrl: 'https://example.test/proxy/',
    fetch: async (input) => {
      assert.equal(String(input), 'https://example.test/proxy/api/v1/ready')
      return Response.json(successBody({ status: 'ok', database: 'ok', private: 'hidden' }), {
        headers: { 'x-request-id': 'trace' },
      })
    },
  })
  assert.deepEqual(await client.ready(), { data: { status: 'ok', database: 'ok' }, requestId: 'trace' })
})

test('进程存活响应不能当成数据库就绪响应', async () => {
  const client = createApiClient({
    baseUrl: 'https://example.test',
    fetch: async () => Response.json(successBody({ status: 'ok' })),
  })
  assert.equal((await client.health()).data.status, 'ok')
  await assert.rejects(
    client.ready(),
    (error: unknown) => error instanceof RequestError && error.code === 'INVALID_RESPONSE',
  )
})

test('业务失败返回 BUSINESS_ERROR，保留业务码且不透传服务端正文', async () => {
  const client = createApiClient({
    baseUrl: 'https://example.test',
    fetch: async () =>
      Response.json(
        {
          success: false,
          code: 'DATABASE_UNAVAILABLE',
          message: 'private credential',
          requestId: 'trace',
        },
        { status: 200, headers: { 'x-request-id': 'trace' } },
      ),
  })
  await assert.rejects(client.ready(), (error: unknown) => {
    assert.ok(error instanceof RequestError)
    assert.equal(error.code, 'BUSINESS_ERROR')
    assert.equal(error.status, 200)
    assert.equal(error.responseValid, true)
    assert.equal(error.serverCode, 'DATABASE_UNAVAILABLE')
    assert.equal(error.requestId, 'trace')
    assert.equal(error.message.includes('private credential'), false)
    return true
  })
})

test('契约外响应在 HTTP 200 时返回 INVALID_RESPONSE', async () => {
  const client = createApiClient({
    baseUrl: 'https://example.test',
    fetch: async () => Response.json({ success: true, message: 'missing fields' }),
  })
  await assert.rejects(
    client.health(),
    (error: unknown) => error instanceof RequestError && error.code === 'INVALID_RESPONSE',
  )
})

test('非 200 传输错误校验错误信封并保留来源业务码', async () => {
  for (const valid of [true, false]) {
    const client = createApiClient({
      baseUrl: 'https://example.test',
      fetch: async () =>
        Response.json(
          valid
            ? { success: false, code: 'INTERNAL_ERROR', message: 'private credential', requestId: 'trace' }
            : { message: 'private credential' },
          { status: 503 },
        ),
    })
    await assert.rejects(client.ready(), (error: unknown) => {
      assert.ok(error instanceof RequestError)
      assert.equal(error.code, 'HTTP_ERROR')
      assert.equal(error.status, 503)
      assert.equal(error.responseValid, valid)
      assert.equal(error.serverCode, valid ? 'INTERNAL_ERROR' : null)
      assert.equal(error.message.includes('private credential'), false)
      return true
    })
  }
})

test('无效配置在网络请求前被拒绝', () => {
  for (const baseUrl of [
    'invalid',
    'file:///etc/passwd',
    'https://user:secret@example.test',
    'https://example.test?token=secret',
  ]) {
    assert.throws(() => createApiClient({ baseUrl }))
  }
  for (const timeoutMs of [0, -1, 1.5, 300_001]) {
    assert.throws(() => createApiClient({ baseUrl: 'https://example.test', timeoutMs }))
  }
})
