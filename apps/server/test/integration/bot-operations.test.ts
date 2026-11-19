import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createFauxBotRunner } from '@dev-ops/devops-bot/testing'
import { and, eq } from 'drizzle-orm'
import { Type } from 'typebox'
import { Check } from 'typebox/value'
import { createHttpApp } from '../../src/bootstrap/create-http-app.ts'
import { botMemoryCursor } from '../../src/modules/bots/bots.platform.tables.ts'
import { claimBotRun } from '../../src/modules/bots/bots.run-queue.repository.ts'
import { botMemory, botRun } from '../../src/modules/bots/bots.tables.ts'
import { executeClaimedBotRun, type BotRunner } from '../../src/modules/bots/runtime/execute-run.ts'
import { createBotTestDatabase } from '../support/bot-database.ts'
import { seedBotWorkflowFixture } from '../support/bot-workflow-fixtures.ts'

const consolidationInput = Type.Object({
  records: Type.Array(Type.Object({ id: Type.String(), userId: Type.Union([Type.String(), Type.Null()]) })),
})

test('团队上下文、运行用量、预算与记忆整理在真实数据库中闭环', async (t) => {
  const { db, config: base, cleanup } = await createBotTestDatabase(t)
  const workspace = await mkdtemp(join(tmpdir(), 'devops-bot-operations-'))
  cleanup.push(() => rm(workspace, { recursive: true, force: true }))
  const config = {
    ...base,
    BOT_WORKSPACE_DIR: workspace,
    GIT_CREDENTIAL_ENCRYPTION_KEY: Buffer.alloc(32, 15).toString('base64'),
  }
  const app = createHttpApp(config)
  cleanup.push(() => app.close())
  const { teamPath, teamId, roomPath, botId, adminUser, viewerUser, devUser, get, post } =
    await seedBotWorkflowFixture(app)
  const context = `${teamPath}/bot-context`
  assert.equal((await get(context, viewerUser)).data.version, 0)
  assert.equal((await post(context, { content: '无权限', version: 0 })).code, 'FORBIDDEN')
  assert.equal(
    (await post(context, { content: '汉'.repeat(7000), version: 0 }, adminUser)).code,
    'BOT_CONTEXT_TOO_LARGE',
  )
  assert.equal((await post(context, { content: '团队约定保留发布记录', version: 0 }, adminUser)).code, 'OK')
  assert.equal((await post(context, { content: '过期版本', version: 0 }, adminUser)).code, 'VERSION_CONFLICT')

  async function runOne(execute: BotRunner) {
    const run = await claimBotRun(db, 'operations-fixture', { global: 2, perTeam: 2, ttlSeconds: 30 })
    assert.ok(run)
    await executeClaimedBotRun(
      { db, config, cipher: null, execute, onFailure: () => assert.fail('执行进程出错') },
      run,
      new AbortController().signal,
    )
    return run
  }
  const send = (text: string) => post(`${roomPath}/messages`, { text, clientRequestId: randomUUID() })
  assert.equal((await send('以后发布前请提示我检查邮件')).code, 'OK')
  await runOne(async (options) => {
    assert.match(options.context.platformRules, /须遵守平台约束/u)
    assert.equal(options.context.layers.find(({ title }) => title === '团队上下文')?.body, '团队约定保留发布记录')
    assert.ok(
      options.context.layers.findIndex(({ title }) => title === '团队上下文') <
        options.context.layers.findIndex(({ title }) => title === 'Bot 职责'),
    )
    return createFauxBotRunner('已记录发布约定')(options)
  })
  const usage = `${teamPath}/bot-usage`
  assert.equal((await get(usage, viewerUser)).data.byBot[0].unknownCostRuns, 1)
  assert.ok(Number((await get(usage)).data.total.outputTokens) > 0)

  const budget = `${teamPath}/bot-budget`
  assert.equal((await post(budget, { monthlyLimitUsd: '0' })).code, 'FORBIDDEN')
  const beforeBudget = await send('预算更新前已排队')
  assert.equal(beforeBudget.code, 'OK')
  const existing = await claimBotRun(db, 'operations-fixture', { global: 1, perTeam: 1, ttlSeconds: 30 })
  assert.ok(existing)
  assert.equal((await post(budget, { monthlyLimitUsd: '0' }, adminUser)).code, 'OK')
  const another = await post(`${teamPath}/bot-conversations`, { botId, kind: 'direct' }, adminUser)
  assert.equal(another.code, 'OK')
  const rejected = await post(
    `/bot-conversations/${another.data.id}/messages`,
    { text: '不应新启动', clientRequestId: randomUUID() },
    adminUser,
  )
  assert.equal(rejected.code, 'BOT_BUDGET_EXHAUSTED')
  await executeClaimedBotRun(
    {
      db,
      config,
      cipher: null,
      execute: createFauxBotRunner('已在运行的工作完成'),
      onFailure: () => assert.fail('预算终态出错'),
    },
    existing,
    new AbortController().signal,
  )
  assert.equal((await get(usage)).data.total.unknownCostRuns, 2)
  assert.equal((await post(budget, { monthlyLimitUsd: null }, adminUser)).code, 'OK')

  const consolidate = `/bots/${botId}/memories/consolidate`
  assert.equal((await post(consolidate, {})).code, 'FORBIDDEN')
  const queued = await post(consolidate, {}, adminUser)
  assert.ok(queued.data.runId)
  const job = await runOne(async (options) => {
    assert.equal(options.input.kind, 'prompt')
    const input: unknown = JSON.parse(options.input.text)
    assert.ok(Check(consolidationInput, input))
    const source = input.records.find((row) => row.userId === devUser.userId)
    assert.ok(source)
    const submit = options.tools.find(({ name }) => name === 'submit_memory_consolidation')
    assert.ok(submit)
    const draft = { action: 'add', scope: 'user', userId: devUser.userId, essential: false, evidenceIds: [source.id] }
    assert.equal(
      (
        await submit.execute(
          { operations: [{ ...draft, content: 'sk-' + 'fixture-secret-value'.repeat(3) }] },
          options.signal,
        )
      ).isError,
      true,
    )
    assert.equal(
      (await submit.execute({ operations: [{ ...draft, content: '发布前提示检查邮件' }] }, options.signal)).isError,
      undefined,
    )
    return createFauxBotRunner('已提交整理结果')(options)
  })
  assert.equal(job.kind, 'memory_consolidation')
  const [after] = await db
    .select()
    .from(botMemoryCursor)
    .where(and(eq(botMemoryCursor.team_id, teamId), eq(botMemoryCursor.bot_id, botId)))
  assert.equal(after?.last_result, 'applied')
  const saved = await get(`${teamPath}/bot-memories?botId=${botId}`)
  assert.equal(saved.data.items[0].content, '发布前提示检查邮件')
  assert.equal(saved.data.items[0].source.kind, 'consolidation')
  assert.equal((await post(consolidate, {}, adminUser)).data.runId, null)

  await db
    .update(botRun)
    .set({ created_at: new Date(0) })
    .where(eq(botRun.id, job.id))
  assert.ok((await post(consolidate, {}, adminUser)).data.runId)
  await runOne(async () => assert.fail('没有新消息时不应调用模型'))
  assert.equal((await db.select({ id: botMemory.id }).from(botMemory).where(eq(botMemory.bot_id, botId))).length, 1)
  assert.equal(
    (
      await db
        .select({ result: botMemoryCursor.last_result })
        .from(botMemoryCursor)
        .where(eq(botMemoryCursor.bot_id, botId))
    )[0]?.result,
    'no_change',
  )
})
