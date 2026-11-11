import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { eq } from 'drizzle-orm'
import { pipelineRun } from '../../src/modules/pipeline/pipeline.tables.ts'
import { codeChange } from '../../src/modules/tools/tools.tables.ts'
import { reconcileCodeChangeFromRun } from '../../src/modules/tools/tools.code-change.service.ts'
import { setupPipelineContext } from '../helpers/operations.ts'

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
  await db.insert(codeChange).values({
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
  })

  assert.equal(await reconcileCodeChangeFromRun(db, runId), true)
  const [row] = await db.select().from(codeChange).where(eq(codeChange.id, codeChangeId))
  assert.equal(row?.status, 'succeeded')
  assert.equal(row?.error_code, null)
  assert.equal(await reconcileCodeChangeFromRun(db, runId), false)
})
