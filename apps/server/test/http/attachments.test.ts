import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { test } from 'node:test'
import { createTestApp } from '../support/create-test-app.ts'

const NIL_ID = '00000000-0000-0000-0000-000000000000'

test('未登录访问附件接口返回 UNAUTHENTICATED 且使用统一信封', async (t) => {
  const app = createTestApp()
  t.after(() => app.close())

  const responses = await Promise.all([
    app.inject({ method: 'GET', url: '/api/v1/attachments/policy' }),
    app.inject({ method: 'GET', url: `/api/v1/attachments/${NIL_ID}/download` }),
    app.inject({ method: 'POST', url: `/api/v1/attachments/${NIL_ID}/remove` }),
    app.inject({
      method: 'POST',
      url: `/api/v1/projects/${NIL_ID}/attachments`,
      payload: Buffer.from('hello'),
      headers: {
        'content-type': 'application/octet-stream',
        'x-file-name': encodeURIComponent('说明.txt'),
        'content-length': '5',
      },
    }),
  ])

  for (const response of responses) {
    assert.equal(response.statusCode, 200)
    const body = response.json()
    assert.equal(body.success, false)
    assert.equal(body.code, 'UNAUTHENTICATED')
    assert.equal(typeof body.requestId, 'string')
  }
})

test('附件路由参数校验先于身份校验，非法标识返回 VALIDATION_ERROR', async (t) => {
  const app = createTestApp()
  t.after(() => app.close())

  const invalidAttachmentId = await app.inject({ method: 'GET', url: '/api/v1/attachments/not-a-uuid/download' })
  assert.equal(invalidAttachmentId.statusCode, 200)
  assert.equal(invalidAttachmentId.json().success, false)
  assert.equal(invalidAttachmentId.json().code, 'VALIDATION_ERROR')

  const invalidProjectId = await app.inject({
    method: 'POST',
    url: '/api/v1/projects/not-a-uuid/attachments',
    payload: Buffer.from('hello'),
    headers: {
      'content-type': 'application/octet-stream',
      'x-file-name': encodeURIComponent('说明.txt'),
      'content-length': '5',
    },
  })
  assert.equal(invalidProjectId.statusCode, 200)
  assert.equal(invalidProjectId.json().code, 'VALIDATION_ERROR')
})

test('上传路由接受原始流：提前失败时先 drain 请求体再返回信封，连接不被重置', async (t) => {
  const app = createTestApp()
  t.after(() => app.close())
  const body = randomBytes(300 * 1024)

  const response = await app.inject({
    method: 'POST',
    url: `/api/v1/projects/${NIL_ID}/attachments`,
    payload: body,
    headers: {
      'content-type': 'application/octet-stream',
      'x-file-name': encodeURIComponent('大文件.bin'),
      'content-length': String(body.length),
      'idempotency-key': 'attachments-upload-skip-idempotency',
    },
  })

  assert.equal(response.statusCode, 200)
  const envelope = response.json()
  assert.equal(envelope.success, false)
  assert.equal(envelope.code, 'UNAUTHENTICATED')
  assert.equal(typeof envelope.requestId, 'string')
})

test('附件路由只使用 GET/POST 并已注册', async (t) => {
  const app = createTestApp()
  t.after(() => app.close())
  await app.ready()

  const routes = app.printRoutes({ commonPrefix: false })
  assert.match(routes, /attachments/)
  for (const method of ['PUT', 'PATCH', 'DELETE']) {
    assert.equal(new RegExp(`\\b${method}\\b.*attachments`).test(routes), false, `附件路由不应注册 ${method}`)
  }
})
