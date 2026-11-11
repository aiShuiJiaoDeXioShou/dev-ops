import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import {
  asRecord,
  expectFailure,
  expectSuccess,
  injectJson,
  setupPipelineContext,
  stringField,
} from '../helpers/operations.ts'

test('T045 远端写：能力授权、远端 Issue 与评论', { timeout: 60_000 }, async (t) => {
  const context = await setupPipelineContext(t)
  const { app, projectId, repositoryId, admin, developer, viewer } = context

  const body = {
    repositoryId,
    bugId: randomUUID(),
    title: '远端 Issue 验收',
    body: '由平台创建',
  }
  const denied = await injectJson(app, 'POST', `/api/v1/projects/${projectId}/tools/remote-issues`, {
    cookie: developer.cookie,
    headers: { 'idempotency-key': 'ri-denied' },
    payload: body,
  })
  expectFailure(denied, 'TOOL_CAPABILITY_NOT_GRANTED', '未授权创建远端 Issue')

  for (const capability of ['create_issue', 'add_comment'] as const) {
    expectSuccess(
      await injectJson(app, 'POST', `/api/v1/projects/${projectId}/tools/grants`, {
        cookie: admin.cookie,
        payload: { userId: developer.userId, capability },
      }),
      `授予 ${capability}`,
    )
  }

  const missingBug = await injectJson(app, 'POST', `/api/v1/projects/${projectId}/tools/remote-issues`, {
    cookie: developer.cookie,
    headers: { 'idempotency-key': 'ri-missing-bug' },
    payload: body,
  })
  expectFailure(missingBug, 'NOT_FOUND', 'Bug 不存在')

  const comment = await injectJson(app, 'POST', `/api/v1/projects/${projectId}/tools/comments`, {
    cookie: developer.cookie,
    headers: { 'idempotency-key': 'comment-1' },
    payload: { targetType: 'remote_issue', repositoryId, remoteNumber: 11, body: '远端评论验收' },
  })
  const created = expectSuccess(comment, '创建远端评论')
  assert.equal(stringField(asRecord(created.comment, 'comment'), 'id'), '88')

  const replay = await injectJson(app, 'POST', `/api/v1/projects/${projectId}/tools/comments`, {
    cookie: developer.cookie,
    headers: { 'idempotency-key': 'comment-1' },
    payload: { targetType: 'remote_issue', repositoryId, remoteNumber: 11, body: '远端评论验收' },
  })
  expectFailure(replay, 'REMOTE_WRITE_CONFLICT', '重复评论')

  const viewerComment = await injectJson(app, 'POST', `/api/v1/projects/${projectId}/tools/comments`, {
    cookie: viewer.cookie,
    headers: { 'idempotency-key': 'comment-viewer' },
    payload: { targetType: 'remote_issue', repositoryId, remoteNumber: 11, body: '不应成功' },
  })
  expectFailure(viewerComment, 'FORBIDDEN', '浏览者评论')
})
