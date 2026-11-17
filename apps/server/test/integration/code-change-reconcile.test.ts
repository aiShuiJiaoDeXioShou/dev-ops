import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { eq } from 'drizzle-orm'
import { pipelineArtifact, pipelineRun, pipelineRunStep } from '../../src/modules/pipeline/pipeline.tables.ts'
import { codeChange } from '../../src/modules/tools/tools.tables.ts'
import {
  reconcileCodeChangeFromRun,
  reconcilePendingCodeChanges,
} from '../../src/modules/tools/tools.code-change.service.ts'
import { asRecord, expectSuccess, injectJson, items, setupPipelineContext } from './pipeline-harness.ts'

test('T033 运行收口后回填代码变更状态', { timeout: 60_000 }, async (t) => {
  const context = await setupPipelineContext(t)
  const db = context.app.db
  const runId = randomUUID()
  const codeChangeId = randomUUID()
  await db.insert(pipelineRun).values({
    id: runId,
    team_id: context.teamId,
    project_id: context.projectId,
    repository_id: context.repositoryId,
    workflow_path: 'platform/code-change',
    workflow_name: '受控代码修改',
    git_ref: 'main',
    commit_sha: 'a'.repeat(40),
    inputs: { codeChangeId },
    run_plan: { runId, jobs: [], secretNames: [] },
    workflow_snapshot: 'name: validate',
    workflow_hash: 'b'.repeat(64),
    run_kind: 'code_change',
    secret_environment: 'test',
    status: 'succeeded',
    trigger_source: 'manual',
    initiator_channel: 'api',
    triggered_by_user_id: context.developer.userId,
    idempotency_key: `reconcile-${runId}`,
    timeout_seconds: 900,
    finished_at: new Date(),
  })
  const change = {
    id: codeChangeId,
    team_id: context.teamId,
    project_id: context.projectId,
    repository_id: context.repositoryId,
    invocation_id: randomUUID(),
    base_ref: 'main',
    base_sha: 'a'.repeat(40),
    branch_name: 'feature/demo',
    commit_message: '演示',
    author_name: '开发者',
    author_email: 'dev@example.test',
    patch: 'diff --git a/a.ts b/a.ts\n',
    patch_sha256: 'c'.repeat(64),
    patch_size_bytes: 24,
    validation_workflow_path: '.devops/workflows/validate.yml',
    status: 'running',
    pipeline_run_id: runId,
    created_by_user_id: context.developer.userId,
  }
  await db.insert(codeChange).values([
    change,
    ...Array.from({ length: 50 }, (_, index) => ({
      ...change,
      id: randomUUID(),
      invocation_id: randomUUID(),
      pipeline_run_id: null,
      status: 'queued',
      created_at: new Date(index * 1000),
    })),
  ])

  await db.insert(pipelineRunStep).values({
    id: randomUUID(),
    team_id: context.teamId,
    project_id: context.projectId,
    run_id: runId,
    step_index: 0,
    name: '校验',
    kind: 'run',
    status: 'succeeded',
  })

  const queries = t.mock.method(db.$client, 'query')
  const list = expectSuccess(
    await injectJson(context.app, 'GET', `/api/v1/projects/${context.projectId}/tools/code-changes`, {
      cookie: context.developer.cookie,
    }),
    '读取项目代码变更列表',
  )
  const listItems = items(list).map((item) => asRecord(item, 'codeChange'))
  assert.equal(listItems.length, 50)
  assert.equal(listItems[0]?.id, codeChangeId)
  assert.equal(listItems[0]?.status, 'running')
  assert.equal(asRecord(listItems[0]?.createdBy, 'createdBy').userId, context.developer.userId)
  const statements = queries.mock.calls.flatMap(({ arguments: [query] }: { arguments: unknown[] }) => {
    if (typeof query === 'string') return [query]
    return typeof query === 'object' && query !== null && 'text' in query && typeof query.text === 'string'
      ? [query.text]
      : []
  })
  queries.mock.restore()
  const listStatements = statements.filter((sql) => /from\s+(?:"[^"]+"\.)?"code_change"/i.test(sql))
  assert.equal(listStatements.length, 1)
  assert.doesNotMatch(listStatements[0] ?? '', /"patch"/)
  assert.equal(statements.filter((sql) => /from\s+(?:"[^"]+"\.)?"user".*\sin\s*\(/i.test(sql)).length, 1)
  assert.ok(statements.every((sql) => !/^\s*update\b/i.test(sql)))

  const failOnReconcileError = () => assert.fail('代码变更回填失败')
  await reconcilePendingCodeChanges(db, failOnReconcileError)
  const [row] = await db.select().from(codeChange).where(eq(codeChange.id, codeChangeId))
  assert.equal(row?.status, 'succeeded')
  assert.equal(row?.error_code, null)
  const validation = asRecord(row?.validation_result, 'validation')
  assert.ok(Array.isArray(validation.steps))
  assert.equal(validation.steps.length, 1)
  assert.equal(validation.failedStepIndex, null)
  assert.equal(row?.diff_sha256, null)

  const artifactSha = 'd'.repeat(64)
  await db.insert(pipelineArtifact).values({
    id: randomUUID(),
    team_id: context.teamId,
    project_id: context.projectId,
    run_id: runId,
    step_index: 0,
    name: 'code-change-diff',
    storage_key: `runs/${runId}/code-change.diff`,
    size_bytes: 24,
    sha256: artifactSha,
    status: 'available',
  })
  await reconcilePendingCodeChanges(db, failOnReconcileError)
  const [updated] = await db
    .select({ diffSha: codeChange.diff_sha256 })
    .from(codeChange)
    .where(eq(codeChange.id, codeChangeId))
  assert.equal(updated?.diffSha, artifactSha)
  assert.equal(await reconcileCodeChangeFromRun(db, runId), false)
})
