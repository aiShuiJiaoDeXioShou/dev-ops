import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { test } from 'node:test'
import { codeChange as codeChangeTable } from '../../src/modules/tools/tools.tables.ts'
import { pipelineArtifact, pipelineRun } from '../../src/modules/pipeline/pipeline.tables.ts'
import {
  asRecord,
  expectFailure,
  expectSuccess,
  injectJson,
  setupPipelineContext,
  stringField,
  VALID_WORKFLOW,
} from '../helpers/operations.ts'

const patch = 'diff --git a/src/a.ts b/src/a.ts\n+export const a = 1\n'
const patchSha = createHash('sha256').update(patch, 'utf8').digest('hex')

test('T039 代码变更：能力授权、补丁校验、幂等与队列', { timeout: 90_000 }, async (t) => {
  const context = await setupPipelineContext(t)
  const { app, projectId, repositoryId, admin, developer, viewer } = context
  context.git.setFile('.devops/workflows/validate.yml', VALID_WORKFLOW)

  const body = {
    repositoryId,
    baseRef: 'main',
    branchName: 'feature/demo',
    commitMessage: '演示修改',
    patch,
    patchSha256: patchSha,
    validationWorkflowPath: '.devops/workflows/validate.yml',
    secretEnvironment: 'test',
  }

  const denied = await injectJson(app, 'POST', `/api/v1/projects/${projectId}/tools/code-changes`, {
    cookie: developer.cookie,
    headers: { 'idempotency-key': 'cc-denied' },
    payload: body,
  })
  expectFailure(denied, 'TOOL_CAPABILITY_NOT_GRANTED', '未授权创建')

  expectSuccess(
    await injectJson(app, 'POST', `/api/v1/projects/${projectId}/tools/grants`, {
      cookie: admin.cookie,
      payload: { userId: developer.userId, capability: 'code_change' },
    }),
    '授予代码修改能力',
  )

  const badHash = await injectJson(app, 'POST', `/api/v1/projects/${projectId}/tools/code-changes`, {
    cookie: developer.cookie,
    headers: { 'idempotency-key': 'cc-bad-hash' },
    payload: { ...body, patchSha256: 'f'.repeat(64) },
  })
  expectFailure(badHash, 'CODE_CHANGE_INVALID_PATCH', '摘要不一致')

  const created = await injectJson(app, 'POST', `/api/v1/projects/${projectId}/tools/code-changes`, {
    cookie: developer.cookie,
    headers: { 'idempotency-key': 'cc-1' },
    payload: body,
  })
  const first = expectSuccess(created, '创建代码变更')
  const codeChange = asRecord(first.codeChange, 'codeChange')
  const codeChangeId = stringField(codeChange, 'id')
  assert.ok(['queued', 'running', 'succeeded'].includes(stringField(codeChange, 'status')))
  assert.ok(codeChange.pipelineRunId)

  const replay = await injectJson(app, 'POST', `/api/v1/projects/${projectId}/tools/code-changes`, {
    cookie: developer.cookie,
    headers: { 'idempotency-key': 'cc-1' },
    payload: body,
  })
  const replayed = expectSuccess(replay, '重复创建')
  assert.equal(stringField(asRecord(replayed.codeChange, 'codeChange'), 'id'), codeChangeId)

  const viewerCreate = await injectJson(app, 'POST', `/api/v1/projects/${projectId}/tools/code-changes`, {
    cookie: viewer.cookie,
    headers: { 'idempotency-key': 'cc-viewer' },
    payload: body,
  })
  expectFailure(viewerCreate, 'FORBIDDEN', '浏览者创建')

  // 模拟运行成功并产出差异，读取详情时回填差异元数据。
  const runId = stringField(codeChange, 'pipelineRunId')
  await context.app.db
    .update(pipelineRun)
    .set({ status: 'succeeded', finished_at: new Date() })
    .where(eq(pipelineRun.id, runId))
  const diffContent = 'diff --git a/a.ts b/a.ts\n+patched\n'
  const storageKey = `runs/${runId}/code-change.diff`
  await mkdir(join(context.storageDir, 'runs', runId), { recursive: true })
  await writeFile(join(context.storageDir, storageKey), diffContent)
  await context.app.db.insert(pipelineArtifact).values({
    id: crypto.randomUUID(),
    team_id: context.teamId,
    project_id: projectId,
    run_id: runId,
    step_index: 1,
    name: 'code-change-diff',
    storage_key: storageKey,
    size_bytes: Buffer.byteLength(diffContent),
    sha256: createHash('sha256').update(diffContent).digest('hex'),
    status: 'available',
  })
  const detail = expectSuccess(
    await injectJson(app, 'GET', `/api/v1/tools/code-changes/${codeChangeId}`, { cookie: developer.cookie }),
    '读取代码变更详情',
  )
  const detailChange = asRecord(detail.codeChange, 'codeChange')
  assert.equal(asRecord(detailChange.diff, 'diff').sha256, createHash('sha256').update(diffContent).digest('hex'))
  const [row] = await context.app.db.select().from(codeChangeTable).where(eq(codeChangeTable.id, codeChangeId))
  assert.equal(row?.diff_storage_key, storageKey)
  assert.equal(row?.diff_size_bytes, Buffer.byteLength(diffContent))
})
