import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { eq } from 'drizzle-orm'
import { pipelineArtifact } from '../../src/modules/pipeline/pipeline.tables.ts'
import {
  asRecord,
  expectFailure,
  getRunDetail,
  injectJson,
  items,
  listenAndGetBaseUrl,
  parseEnvelope,
  prepareRunningLease,
  setupPipelineContext,
  stringField,
  triggerRun,
  uploadArtifact,
  uploadLogs,
  type TestActor,
  type TestResponse,
} from './pipeline-harness.ts'

/** 取数组首项；空数组时抛出带标签的错误。 */
function firstItem<T>(values: T[], label: string): T {
  const value = values[0]
  if (value === undefined) throw new Error(`${label} 为空`)
  return value
}

/** 读取列表 total。 */
function totalOf(record: Record<string, unknown>): number {
  const value = record.total
  if (typeof value !== 'number') throw new Error(`列表缺少 total：${JSON.stringify(record)}`)
  return value
}

/** 读取列表项的运行标识。 */
function runIdOfItem(value: unknown): string {
  return stringField(asRecord(value, '运行列表项'), 'runId')
}

/** 按页读取全部运行标识；用于验证分页稳定且无重复。 */
async function readAllRunIds(response: TestResponse): Promise<{ ids: string[]; createdAt: string[] }> {
  assert.equal(response.envelope.success, true, response.body)
  const data = asRecord(response.envelope.data, '运行列表')
  const ids: string[] = []
  const createdAt: string[] = []
  for (const item of items(data)) {
    const record = asRecord(item, '运行列表项')
    ids.push(runIdOfItem(record))
    createdAt.push(stringField(record, 'createdAt'))
  }
  return { ids, createdAt }
}

test('T052/T095/T074 运行读取：日志 afterSeq、筛选分页、产物越权与存储路径穿越', { timeout: 240_000 }, async (t) => {
  const context = await setupPipelineContext(t)
  const baseUrl = await listenAndGetBaseUrl(context.app)
  const { app } = context

  // 准备一条带日志与产物的运行：租约由 Agent 领取，日志/产物通过 Agent 端点上送。
  const lease = await prepareRunningLease(context)
  const logs = await uploadLogs(context, lease.agentToken, lease.leaseId, lease.leaseToken, [
    { stepIndex: 1, seq: 0, content: 'install-0\n' },
    { stepIndex: 1, seq: 1, content: 'install-1\n' },
    { stepIndex: 1, seq: 2, content: 'install-2\n' },
    { stepIndex: 2, seq: 0, content: 'build-0\n' },
  ])
  assert.equal(logs.envelope.success, true, logs.body)
  const artifact = await uploadArtifact(baseUrl, lease.agentToken, lease.leaseId, lease.leaseToken, {
    stepIndex: 3,
    name: 'web-dist',
    content: Buffer.from('dist'),
  })

  await t.test('T052 日志读取：afterSeq/limit、跨步骤合并与 stepIndex 越界', async () => {
    const page = await injectJson(
      app,
      'GET',
      `/api/v1/pipeline-runs/${lease.runId}/logs?stepIndex=1&afterSeq=0&limit=1`,
      { cookie: context.viewer.cookie },
    )
    assert.equal(page.envelope.success, true, page.body)
    const pageData = asRecord(page.envelope.data, '日志 data')
    assert.equal(pageData.stepIndex, 1)
    const pageItems = items(pageData)
    assert.equal(pageItems.length, 1)
    assert.equal(asRecord(pageItems[0], '日志分片').seq, 1)
    assert.equal(pageData.nextSeq, 1)
    assert.equal(pageData.hasMore, true)

    const allStep1 = await injectJson(app, 'GET', `/api/v1/pipeline-runs/${lease.runId}/logs?stepIndex=1&limit=10`, {
      cookie: context.viewer.cookie,
    })
    const step1Data = asRecord(allStep1.envelope.data, '日志 data')
    const step1Seqs = items(step1Data).map((item) => asRecord(item, '日志分片').seq)
    assert.deepEqual(step1Seqs, [0, 1, 2], '不传 afterSeq 时应从首片 seq=0 开始返回')
    assert.equal(step1Data.hasMore, false)
    assert.equal(
      stringField(
        firstItem(
          items(step1Data).map((item) => asRecord(item, '日志分片')),
          '日志分片',
        ),
        'content',
      ),
      'install-0\n',
    )

    const combined = await injectJson(app, 'GET', `/api/v1/pipeline-runs/${lease.runId}/logs?limit=20`, {
      cookie: context.viewer.cookie,
    })
    const combinedData = asRecord(combined.envelope.data, '日志 data')
    assert.equal(combinedData.stepIndex, null, '未指定 stepIndex 时返回 null 并合并所有步骤')
    const combinedItems = items(combinedData).map((item) => asRecord(item, '日志分片'))
    assert.equal(combinedItems.length, 4, '应合并 step1 的 seq0/1/2 与 step2 的 seq0')
    assert.deepEqual(
      combinedItems.map((item) => item.seq),
      [0, 1, 2, 0],
    )

    const outOfRange = await injectJson(app, 'GET', `/api/v1/pipeline-runs/${lease.runId}/logs?stepIndex=99`, {
      cookie: context.viewer.cookie,
    })
    expectFailure(outOfRange, 'PIPELINE_LOG_NOT_FOUND', '步骤越界读取日志')

    const crossTeam = await injectJson(app, 'GET', `/api/v1/pipeline-runs/${lease.runId}/logs`, {
      cookie: context.stranger.cookie,
    })
    expectFailure(crossTeam, 'FORBIDDEN', '跨团队读取日志')

    const beyond = await injectJson(app, 'GET', `/api/v1/pipeline-runs/${lease.runId}/logs?stepIndex=1&afterSeq=999`, {
      cookie: context.viewer.cookie,
    })
    const beyondData = asRecord(beyond.envelope.data, '日志 data')
    assert.equal(items(beyondData).length, 0)
    assert.equal(beyondData.hasMore, false)
  })

  await t.test('T052 首片可达性：默认 afterSeq=0 时 seq=0 的日志分片应可读取', async () => {
    const response = await injectJson(app, 'GET', `/api/v1/pipeline-runs/${lease.runId}/logs?stepIndex=1`, {
      cookie: context.viewer.cookie,
    })
    const data = asRecord(response.envelope.data, '日志 data')
    const seqs = items(data).map((item) => asRecord(item, '日志分片').seq)
    assert.equal(seqs.includes(0), true, `默认读取应包含 seq=0 的分片，实际 seq=${JSON.stringify(seqs)}（D5）`)
  })

  await t.test('T095 运行筛选与分页：工作流/状态/日期、稳定排序与非法参数', async () => {
    const workflowPath = '.devops/workflows/ci.yml'
    const secondaryPath = '.devops/workflows/secondary.yml'
    context.git.setFile(
      secondaryPath,
      `name: secondary\non:\n  workflow_dispatch:\n    inputs:\n      target:\n        default: api\n        type: string\njobs:\n  build:\n    runs-on: linux\n    steps:\n      - uses: builtin:checkout\n      - run: echo secondary\n`,
    )
    const baseline = await injectJson(
      app,
      'GET',
      `/api/v1/projects/${context.projectId}/pipeline-runs?pageSize=100&workflowPath=${encodeURIComponent(workflowPath)}`,
      { cookie: context.developer.cookie },
    )
    const baselineData = asRecord(baseline.envelope.data, '运行列表')
    const baselineTotal = totalOf(baselineData)

    const secondaryRuns = await Promise.all(
      Array.from({ length: 2 }, () => triggerRun(context, context.developer, { workflowPath: secondaryPath })),
    )
    const cancelledRun = await triggerRun(context, context.developer, { workflowPath })
    const cancelResponse = await injectJson(app, 'POST', `/api/v1/pipeline-runs/${cancelledRun.runId}/cancel`, {
      cookie: context.developer.cookie,
      payload: { reason: '筛选测试取消' },
    })
    assert.equal(cancelResponse.envelope.success, true, cancelResponse.body)

    const paged = await injectJson(
      app,
      'GET',
      `/api/v1/projects/${context.projectId}/pipeline-runs?page=1&pageSize=2&workflowPath=${encodeURIComponent(workflowPath)}`,
      { cookie: context.viewer.cookie },
    )
    const pagedData = asRecord(paged.envelope.data, '运行列表')
    const firstPage = await readAllRunIds(paged)
    assert.equal(firstPage.ids.length, 2)
    assert.equal(totalOf(pagedData), baselineTotal + 1, '分页 total 应统计全部匹配记录')
    assert.equal(pagedData.page, 1)
    assert.equal(pagedData.pageSize, 2)

    const secondPage = await injectJson(
      app,
      'GET',
      `/api/v1/projects/${context.projectId}/pipeline-runs?page=2&pageSize=2&workflowPath=${encodeURIComponent(workflowPath)}`,
      { cookie: context.viewer.cookie },
    )
    const secondPageData = await readAllRunIds(secondPage)
    assert.equal(
      new Set([...firstPage.ids, ...secondPageData.ids]).size,
      firstPage.ids.length + secondPageData.ids.length,
      '分页不应重复',
    )
    const allTimes = [...firstPage.createdAt, ...secondPageData.createdAt].map((value) => Date.parse(value))
    const sorted = [...allTimes].sort((left, right) => right - left)
    assert.deepEqual(allTimes, sorted, '按 createdAt 倒序稳定排序')

    const secondaryList = await injectJson(
      app,
      'GET',
      `/api/v1/projects/${context.projectId}/pipeline-runs?pageSize=100&workflowPath=${encodeURIComponent(secondaryPath)}`,
      { cookie: context.viewer.cookie },
    )
    assert.equal(totalOf(asRecord(secondaryList.envelope.data, '运行列表')), 2)
    assert.deepEqual(
      (await readAllRunIds(secondaryList)).ids.sort(),
      secondaryRuns.map((run) => run.runId).sort(),
      'workflowPath 筛选只返回对应工作流的运行',
    )

    const cancelledList = await injectJson(
      app,
      'GET',
      `/api/v1/projects/${context.projectId}/pipeline-runs?pageSize=100&status=cancelled`,
      { cookie: context.viewer.cookie },
    )
    const cancelledData = asRecord(cancelledList.envelope.data, '运行列表')
    assert.equal(totalOf(cancelledData), 1, 'status 筛选应返回已取消运行')
    assert.equal(runIdOfItem(firstItem(items(cancelledData), '取消筛选列表')), cancelledRun.runId)

    const today = new Date().toISOString().slice(0, 10)
    const todayList = await injectJson(
      app,
      'GET',
      `/api/v1/projects/${context.projectId}/pipeline-runs?pageSize=100&from=${today}&to=${today}`,
      { cookie: context.viewer.cookie },
    )
    assert.equal(totalOf(asRecord(todayList.envelope.data, '运行列表')) >= 3, true, '当日日期筛选应包含今日运行')
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)
    const tomorrowList = await injectJson(
      app,
      'GET',
      `/api/v1/projects/${context.projectId}/pipeline-runs?pageSize=100&from=${tomorrow}`,
      { cookie: context.viewer.cookie },
    )
    assert.equal(totalOf(asRecord(tomorrowList.envelope.data, '运行列表')), 0, '未来日期筛选应无结果')

    const invalidPageSize = await injectJson(
      app,
      'GET',
      `/api/v1/projects/${context.projectId}/pipeline-runs?pageSize=101`,
      { cookie: context.viewer.cookie },
    )
    expectFailure(invalidPageSize, 'VALIDATION_ERROR', 'pageSize 超过 100')
    const invalidPage = await injectJson(app, 'GET', `/api/v1/projects/${context.projectId}/pipeline-runs?page=0`, {
      cookie: context.viewer.cookie,
    })
    expectFailure(invalidPage, 'VALIDATION_ERROR', 'page 小于 1')
    const invalidDate = await injectJson(
      app,
      'GET',
      `/api/v1/projects/${context.projectId}/pipeline-runs?from=2026-13-40`,
      { cookie: context.viewer.cookie },
    )
    expectFailure(invalidDate, 'VALIDATION_ERROR', '非法日期')

    const strangerList = await injectJson(app, 'GET', `/api/v1/projects/${context.projectId}/pipeline-runs`, {
      cookie: context.stranger.cookie,
    })
    expectFailure(strangerList, 'FORBIDDEN', '跨团队读取运行列表')
    const anonymousList = await injectJson(app, 'GET', `/api/v1/projects/${context.projectId}/pipeline-runs`)
    expectFailure(anonymousList, 'UNAUTHENTICATED', '匿名读取运行列表')
  })

  await t.test('T074 产物鉴权与存储路径穿越：跨团队拒绝、不存在、被篡改 storage_key 拒绝', async () => {
    const list = await injectJson(app, 'GET', `/api/v1/pipeline-runs/${lease.runId}/artifacts`, {
      cookie: context.viewer.cookie,
    })
    assert.equal(list.envelope.success, true, list.body)
    const artifactItems = items(asRecord(list.envelope.data, '产物列表')).map((item) => asRecord(item, '产物项'))
    assert.equal(artifactItems.length, 1)
    assert.equal(stringField(firstItem(artifactItems, '产物列表'), 'artifactId'), artifact.artifactId)

    const crossTeamDownload = await app.inject({
      method: 'GET',
      url: `/api/v1/pipeline-artifacts/${artifact.artifactId}/download`,
      headers: { cookie: context.stranger.cookie },
    })
    const crossEnvelope = parseEnvelope({
      json: () => JSON.parse(crossTeamDownload.body),
      body: crossTeamDownload.body,
    })
    assert.equal(crossEnvelope.success, false, '跨团队下载应被拒绝')
    assert.equal(crossEnvelope.code, 'FORBIDDEN')

    const crossTeamList = await injectJson(app, 'GET', `/api/v1/pipeline-runs/${lease.runId}/artifacts`, {
      cookie: context.stranger.cookie,
    })
    expectFailure(crossTeamList, 'FORBIDDEN', '跨团队读取产物列表')

    const notFound = await injectJson(app, 'GET', `/api/v1/pipeline-artifacts/${randomUUID()}/download`, {
      cookie: context.viewer.cookie,
    })
    expectFailure(notFound, 'PIPELINE_ARTIFACT_NOT_FOUND', '下载不存在的产物')

    await app.db
      .update(pipelineArtifact)
      .set({ storage_key: '../../etc/passwd' })
      .where(eq(pipelineArtifact.id, artifact.artifactId))
    const traversal = await app.inject({
      method: 'GET',
      url: `/api/v1/pipeline-artifacts/${artifact.artifactId}/download`,
      headers: { cookie: context.viewer.cookie },
    })
    const traversalEnvelope = parseEnvelope({ json: () => JSON.parse(traversal.body), body: traversal.body })
    assert.equal(traversalEnvelope.success, false, '被篡改的 storage_key 不应返回文件内容')
    assert.equal(traversalEnvelope.code, 'PIPELINE_STORAGE_ERROR')

    const runDetail = await getRunDetail(context, context.viewer, lease.runId)
    assert.ok('artifacts' in runDetail, '运行详情应包含产物列表')
    const actor: TestActor = context.viewer
    assert.ok(actor.cookie.length > 0)
  })
})
