import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { eq } from 'drizzle-orm'
import { GitAdapterError } from '../../src/adapters/git/git.types.ts'
import { activity } from '../../src/modules/collaboration/collaboration.tables.ts'
import { pipelineRun, pipelineRunStep } from '../../src/modules/pipeline/pipeline.tables.ts'
import {
  VALID_WORKFLOW,
  TEST_COMMIT_SHA,
  arrayField,
  asRecord,
  expectFailure,
  expectSuccess,
  getRunDetail,
  injectJson,
  items,
  runIdOf,
  setupPipelineContext,
  stringField,
  triggerRun,
  type TestActor,
} from './pipeline-harness.ts'

/** 断言值可由 Date 解析为 ISO 时间字符串；契约允许的可空字段为 null。 */
function assertIsoTimestamp(value: unknown, label: string): void {
  if (value === null) return
  assert.equal(typeof value, 'string', `${label} 应为字符串或 null`)
  assert.ok(!Number.isNaN(Date.parse(String(value))), `${label} 应为 ISO 时间：${String(value)}`)
}

/** 契约要求的运行摘要字段；缺字段直接报缺陷而不是静默跳过。 */
function assertRunSummaryShape(data: Record<string, unknown>): void {
  for (const key of [
    'runId',
    'workflowPath',
    'workflowName',
    'ref',
    'commitSha',
    'status',
    'initiator',
    'createdAt',
  ] as const) {
    assert.ok(key in data, `运行摘要缺少契约字段 ${key}`)
  }
  assert.equal(stringField(data, 'runId').length > 0, true, 'runId 不应为空')
  assertIsoTimestamp(data.createdAt, 'createdAt')
  assertIsoTimestamp(data.startedAt, 'startedAt')
  assertIsoTimestamp(data.finishedAt, 'finishedAt')
}

test('T028 触发运行：工作流校验、提交固定、快照、幂等、权限与活动记录', { timeout: 120_000 }, async (t) => {
  const context = await setupPipelineContext(t)
  const { app } = context
  const workflowListUrl = `/api/v1/projects/${context.projectId}/pipeline-workflows`

  await t.test('工作流列表按 ref 发现合法与非法文件并返回解析错误', async () => {
    const response = await injectJson(app, 'GET', workflowListUrl, { cookie: context.viewer.cookie })
    const data = expectSuccess(response, '列出工作流')
    assert.equal(stringField(data, 'ref'), 'main')
    assert.equal(stringField(data, 'commitSha'), TEST_COMMIT_SHA)
    const list = items(data)
    assert.ok(list.length >= 3, `应至少发现 3 个 workflow 文件，实际 ${list.length}`)
    const byPath = new Map<string, Record<string, unknown>>()
    for (const item of list) {
      const record = asRecord(item, '工作流列表项')
      byPath.set(stringField(record, 'path'), record)
    }
    const valid = byPath.get('.devops/workflows/ci.yml')
    assert.ok(valid, '应包含 ci.yml')
    assert.equal(valid.valid, true)
    assert.equal(valid.name, 'web-build')
    assert.equal(arrayField(valid, 'parseErrors').length, 0)
    assert.ok('lastRun' in valid, '工作流项应包含 lastRun')

    const invalid = byPath.get('.devops/workflows/broken.yaml')
    assert.ok(invalid, '应包含 broken.yaml')
    assert.equal(invalid.valid, false)
    const parseErrors = arrayField(invalid, 'parseErrors').map((issue) => asRecord(issue, '解析错误'))
    assert.ok(parseErrors.length > 0, '非法 YAML 应返回解析错误')
    assert.equal(stringField(parseErrors[0] ?? {}, 'code'), 'WORKFLOW_PARSE_ERROR')

    const unsupported = byPath.get('.devops/workflows/unsupported.yml')
    assert.ok(unsupported, '应包含 unsupported.yml')
    assert.equal(unsupported.valid, false)
    const unsupportedErrors = arrayField(unsupported, 'parseErrors').map((issue) => asRecord(issue, '不支持错误'))
    assert.equal(stringField(unsupportedErrors[0] ?? {}, 'code'), 'WORKFLOW_UNSUPPORTED')
  })

  await t.test('工作流详情返回内容、哈希与计划摘要', async () => {
    const response = await injectJson(
      app,
      'GET',
      `/api/v1/projects/${context.projectId}/pipeline-workflows/detail?path=${encodeURIComponent('.devops/workflows/ci.yml')}&ref=main`,
      { cookie: context.viewer.cookie },
    )
    const data = expectSuccess(response, '读取工作流详情')
    assert.equal(stringField(data, 'path'), '.devops/workflows/ci.yml')
    assert.equal(stringField(data, 'content'), VALID_WORKFLOW)
    assert.equal(stringField(data, 'contentHash'), createHash('sha256').update(VALID_WORKFLOW).digest('hex'))
    assert.equal(data.valid, true)
    assert.equal(stringField(data, 'commitSha'), TEST_COMMIT_SHA)
    const summary = asRecord(data.planSummary, '计划摘要')
    const jobs = arrayField(summary, 'jobs').map((job) => asRecord(job, '计划 job'))
    assert.equal(jobs.length, 1)
    assert.equal(stringField(jobs[0] ?? {}, 'id'), 'build')
  })

  await t.test('非法工作流不可触发，且不创建运行记录', async () => {
    const response = await injectJson(app, 'POST', `/api/v1/projects/${context.projectId}/pipeline-runs`, {
      cookie: context.developer.cookie,
      payload: {
        workflowPath: '.devops/workflows/broken.yaml',
        ref: 'main',
        idempotencyKey: `invalid-${randomUUID()}`,
      },
    })
    expectFailure(response, 'PIPELINE_WORKFLOW_PARSE_ERROR', '触发非法工作流')
    const list = await injectJson(app, 'GET', `/api/v1/projects/${context.projectId}/pipeline-runs`, {
      cookie: context.developer.cookie,
    })
    const data = expectSuccess(list, '列出运行')
    assert.equal(numberOf(data, 'total'), 0, '校验失败不应创建运行')
  })

  await t.test('触发合法工作流固定提交与快照并写入步骤与活动记录', async () => {
    const before = await app.db.select({ id: activity.id }).from(activity)
    const triggered = await triggerRun(context, context.developer, {
      inputs: { target: 'web' },
      idempotencyKey: `trigger-${randomUUID()}`,
    })
    assert.equal(stringField(triggered.data, 'status'), 'queued')
    assert.equal(stringField(triggered.data, 'ref'), 'main')
    assert.equal(stringField(triggered.data, 'commitSha'), TEST_COMMIT_SHA)
    assert.equal(stringField(triggered.data, 'initiatorChannel'), 'web')
    assert.equal(stringField(triggered.data, 'triggerSource'), 'manual')
    assertRunSummaryShape(triggered.data)
    const steps = arrayField(triggered.data, 'steps').map((step) => asRecord(step, '运行步骤'))
    assert.ok(steps.length >= 4, `运行计划应包含至少 4 个步骤，实际 ${steps.length}`)
    const indexes = steps.map((step) => numberField(step, 'index'))
    assert.deepEqual(
      indexes,
      [...indexes].sort((left, right) => left - right),
      '步骤序号应递增',
    )
    assert.deepEqual(
      steps.map((step) => stringField(step, 'status')),
      steps.map(() => 'pending'),
      '新建运行步骤应为 pending',
    )

    const rows = await app.db.select().from(pipelineRun).where(eq(pipelineRun.id, triggered.runId))
    assert.equal(rows.length, 1)
    const row = rows[0]
    assert.ok(row, '数据库应存在运行记录')
    assert.equal(row.commit_sha, TEST_COMMIT_SHA)
    assert.equal(row.workflow_path, '.devops/workflows/ci.yml')
    assert.equal(row.workflow_snapshot, VALID_WORKFLOW)
    assert.equal(row.workflow_hash, createHash('sha256').update(VALID_WORKFLOW).digest('hex'))
    assert.equal(row.status, 'queued')
    assert.equal(row.triggered_by_user_id, context.developer.userId)
    assert.equal(row.initiator_channel, 'web')
    const plan = asRecord(row.run_plan, '持久化运行计划')
    assert.equal(arrayField(plan, 'jobs').length, 1)
    const stepRows = await app.db.select().from(pipelineRunStep).where(eq(pipelineRunStep.run_id, triggered.runId))
    assert.equal(stepRows.length, steps.length, '数据库步骤数应与运行计划一致')

    const after = await app.db.select({ id: activity.id }).from(activity)
    assert.equal(after.length - before.length, 1, '触发应写入一条活动记录')
    const triggeredActivity = await app.db.select().from(activity).where(eq(activity.entity_id, triggered.runId))
    assert.equal(triggeredActivity.length, 1)
    assert.equal(triggeredActivity[0]?.entity_type, 'pipeline_run')
    assert.equal(triggeredActivity[0]?.action, 'pipeline_run_triggered')
    assert.equal(triggeredActivity[0]?.actor_user_id, context.developer.userId)
  })

  await t.test('同一幂等键返回同一运行且并发请求不创建第二次执行', async () => {
    const idempotencyKey = `idempotent-${randomUUID()}`
    const requests = await Promise.all(
      Array.from({ length: 4 }, () => triggerRun(context, context.developer, { idempotencyKey })),
    )
    const runIds = new Set(requests.map((request) => request.runId))
    assert.equal(runIds.size, 1, `并发幂等请求应返回同一运行，实际 ${runIds.size} 个`)
    const list = await injectJson(
      app,
      'GET',
      `/api/v1/projects/${context.projectId}/pipeline-runs?workflowPath=${encodeURIComponent('.devops/workflows/ci.yml')}&pageSize=100`,
      { cookie: context.developer.cookie },
    )
    const data = expectSuccess(list, '列出运行')
    const runs = items(data).map((item) => asRecord(item, '运行摘要'))
    assert.equal(runs.filter((run) => run.runId === [...runIds][0]).length, 1)
    assert.equal(numberOf(data, 'total'), 2, '幂等触发后应只有两条运行（前一个用例 + 本条）')
  })

  await t.test('触发后修改仓库内容不影响已固定的快照', async () => {
    const triggered = await triggerRun(context, context.admin, { idempotencyKey: `snapshot-${randomUUID()}` })
    context.git.setFile('.devops/workflows/ci.yml', `${VALID_WORKFLOW}\n# changed after trigger\n`)
    const detail = await getRunDetail(context, context.admin, triggered.runId)
    assert.equal(stringField(detail, 'commitSha'), TEST_COMMIT_SHA)
    const rows = await app.db.select().from(pipelineRun).where(eq(pipelineRun.id, triggered.runId))
    assert.equal(rows[0]?.workflow_snapshot, VALID_WORKFLOW, '运行快照不应随仓库变化')
  })

  await t.test('浏览者可读取、不可触发；非项目成员与匿名访问被拒绝', async () => {
    const viewerTrigger = await injectJson(app, 'POST', `/api/v1/projects/${context.projectId}/pipeline-runs`, {
      cookie: context.viewer.cookie,
      payload: { workflowPath: '.devops/workflows/ci.yml', ref: 'main', idempotencyKey: `viewer-${randomUUID()}` },
    })
    expectFailure(viewerTrigger, 'FORBIDDEN', '浏览者触发')
    const strangerTrigger = await injectJson(app, 'POST', `/api/v1/projects/${context.projectId}/pipeline-runs`, {
      cookie: context.stranger.cookie,
      payload: { workflowPath: '.devops/workflows/ci.yml', ref: 'main', idempotencyKey: `stranger-${randomUUID()}` },
    })
    assert.equal(strangerTrigger.envelope.success, false, '非项目成员不应触发成功')
    const anonymousTrigger = await injectJson(app, 'POST', `/api/v1/projects/${context.projectId}/pipeline-runs`, {
      payload: { workflowPath: '.devops/workflows/ci.yml', ref: 'main', idempotencyKey: `anon-${randomUUID()}` },
    })
    expectFailure(anonymousTrigger, 'UNAUTHENTICATED', '匿名触发')
    const viewerList = await injectJson(app, 'GET', `/api/v1/projects/${context.projectId}/pipeline-runs`, {
      cookie: context.viewer.cookie,
    })
    expectSuccess(viewerList, '浏览者读取运行列表')
  })

  await t.test('输入与幂等键校验失败返回业务错误码', async () => {
    const missingKey = await injectJson(app, 'POST', `/api/v1/projects/${context.projectId}/pipeline-runs`, {
      cookie: context.developer.cookie,
      payload: { workflowPath: '.devops/workflows/ci.yml', ref: 'main' },
    })
    assert.equal(missingKey.envelope.success, false)
    assert.equal(missingKey.envelope.code, 'VALIDATION_ERROR')
    const unknownInput = await injectJson(app, 'POST', `/api/v1/projects/${context.projectId}/pipeline-runs`, {
      cookie: context.developer.cookie,
      payload: {
        workflowPath: '.devops/workflows/ci.yml',
        ref: 'main',
        inputs: { notDeclared: 'x' },
        idempotencyKey: `input-${randomUUID()}`,
      },
    })
    expectFailure(unknownInput, 'PIPELINE_WORKFLOW_SCHEMA_ERROR', '未声明输入')
    const defaultedInput = await injectJson(app, 'POST', `/api/v1/projects/${context.projectId}/pipeline-runs`, {
      cookie: context.developer.cookie,
      payload: {
        workflowPath: '.devops/workflows/ci.yml',
        ref: 'main',
        inputs: {},
        idempotencyKey: `default-${randomUUID()}`,
      },
    })
    const defaultedData = expectSuccess(defaultedInput, '空输入应使用 workflow 默认值')
    assert.equal(stringField(defaultedData, 'status'), 'queued')
  })

  await t.test('工作流不存在与仓库不可用分别返回明确错误码', async () => {
    const missingWorkflow = await injectJson(app, 'POST', `/api/v1/projects/${context.projectId}/pipeline-runs`, {
      cookie: context.developer.cookie,
      payload: {
        workflowPath: '.devops/workflows/not-exists.yml',
        ref: 'main',
        idempotencyKey: `missing-${randomUUID()}`,
      },
    })
    expectFailure(missingWorkflow, 'PIPELINE_WORKFLOW_NOT_FOUND', '工作流不存在')
    context.git.failWith(new GitAdapterError('unavailable', '仓库不可用'))
    try {
      const unavailable = await injectJson(app, 'POST', `/api/v1/projects/${context.projectId}/pipeline-runs`, {
        cookie: context.developer.cookie,
        payload: {
          workflowPath: '.devops/workflows/ci.yml',
          ref: 'main',
          idempotencyKey: `unavailable-${randomUUID()}`,
        },
      })
      expectFailure(unavailable, 'PIPELINE_REPOSITORY_UNAVAILABLE', '仓库不可用')
    } finally {
      context.git.failWith(null)
    }
  })

  await t.test('T104 性能：触发接口 p95 小于 2 秒（SC-007）', async () => {
    const durations: number[] = []
    for (let index = 0; index < 20; index += 1) {
      const startedAt = performance.now()
      await triggerRun(context, context.developer, { idempotencyKey: `perf-${index}-${randomUUID()}` })
      durations.push(performance.now() - startedAt)
    }
    const sorted = [...durations].sort((left, right) => left - right)
    const p95 = sorted[Math.ceil(sorted.length * 0.95) - 1] ?? sorted[sorted.length - 1] ?? 0
    assert.ok(p95 < 2_000, `触发接口 p95 应小于 2000ms，实际 ${p95.toFixed(1)}ms`)
  })

  await t.test('运行标识与引用类型符合契约（runId 字段而非内部 id）', async () => {
    const triggered = await triggerRun(context, context.admin, { idempotencyKey: `contract-${randomUUID()}` })
    assert.equal(typeof triggered.data.runId, 'string', '触发响应应使用契约字段 runId')
    const actor: TestActor = context.admin
    const detail = await getRunDetail(context, actor, triggered.runId)
    assert.equal(stringField(detail, 'runId'), triggered.runId)
    assert.equal(runIdOf(detail), triggered.runId)
    assert.ok('inputs' in detail, '运行详情应包含输入摘要')
    assert.ok('logs' in detail, '运行详情应包含日志元数据')
  })
})

/** 读取数值字段；缺失或类型不符时抛出。 */
function numberOf(record: Record<string, unknown>, key: string): number {
  const value = record[key]
  if (typeof value !== 'number') throw new Error(`字段 ${key} 期望数字，实际为 ${typeof value}`)
  return value
}

/** 读取数值字段；缺失或类型不符时抛出。 */
function numberField(record: Record<string, unknown>, key: string): number {
  return numberOf(record, key)
}
