import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createFauxBotCompactor, createFauxBotRunner } from '@dev-ops/devops-bot/testing'
import { and, eq } from 'drizzle-orm'
import { createHttpApp } from '../../src/bootstrap/create-http-app.ts'
import { claimBotRun } from '../../src/modules/bots/bots.run-queue.repository.ts'
import { botSession, botSessionEntry } from '../../src/modules/bots/bots.session.tables.ts'
import { botRun } from '../../src/modules/bots/bots.tables.ts'
import { executeClaimedBotRun, type BotRunner } from '../../src/modules/bots/runtime/execute-run.ts'
import { botMessage } from '../../src/modules/collaboration/bot-conversations.tables.ts'
import { createBotTestDatabase } from '../support/bot-database.ts'
import { seedBotWorkflowFixture } from '../support/bot-workflow-fixtures.ts'

test('房间按游标播种与增量同步，压缩保存原始条目和用量，损坏可重新播种', async (t) => {
  const { db, config: baseConfig, cleanup } = await createBotTestDatabase(t)
  const workspace = await mkdtemp(join(tmpdir(), 'devops-bot-db-workspace-'))
  cleanup.push(() => rm(workspace, { recursive: true, force: true }))
  const config = {
    ...baseConfig,
    BOT_WORKSPACE_DIR: workspace,
    GIT_CREDENTIAL_ENCRYPTION_KEY: Buffer.alloc(32, 67).toString('base64'),
  }
  const app = createHttpApp(config)
  cleanup.push(() => app.close())
  const { teamPath, teamId, botId, adminUser, get, post } = await seedBotWorkflowFixture(app)
  const opened = await post(`${teamPath}/bot-conversations`, { kind: 'direct', botId }, adminUser)
  assert.equal(opened.code, 'OK')
  const roomId = String(opened.data.id)
  const roomPath = `/bot-conversations/${roomId}`
  const botPath = `${roomPath}/bots/${botId}`
  const secret = 'sk-' + 'example-fixture-value'.repeat(2)
  const faux = createFauxBotRunner(`结论 ${secret}`)
  const compact = createFauxBotCompactor('压缩后的历史摘要')
  const scope = and(
    eq(botSession.team_id, teamId),
    eq(botSession.conversation_id, roomId),
    eq(botSession.bot_id, botId),
  )

  async function appendRoomHistory(prefix: string, start: number, count: number) {
    await db.insert(botMessage).values(
      Array.from({ length: count }, (_, index) => ({
        team_id: teamId,
        conversation_id: roomId,
        sequence: BigInt(start + index),
        speaker_kind: 'user',
        speaker_id: adminUser.userId,
        body: {
          blocks: [
            { type: 'text', text: `${prefix}-${String(index).padStart(2, '0')}: ${'项目工作记录。'.repeat(250)}` },
          ],
        },
      })),
    )
  }

  async function runOne(execute: BotRunner = faux) {
    const run = await claimBotRun(db, 'session-runtime-test', { global: 1, perTeam: 1, ttlSeconds: 30 })
    assert.ok(run)
    await executeClaimedBotRun(
      {
        db,
        config,
        cipher: null,
        execute,
        compact,
        onFailure: () => assert.fail('运行出现未处理异常'),
      },
      run,
      new AbortController().signal,
    )
    const [finished] = await db
      .select({ status: botRun.status, usage: botRun.usage, failure: botRun.failure_kind })
      .from(botRun)
      .where(eq(botRun.id, run.id))
    assert.ok(finished)
    return finished
  }

  await appendRoomHistory('播种', 1, 30)
  const first = await post(`${roomPath}/messages`, { text: '首次对话', clientRequestId: randomUUID() }, adminUser)
  assert.equal(first.code, 'OK')
  assert.equal((await post(`${botPath}/compact`, {}, adminUser)).code, 'BOT_RUN_BUSY')
  assert.equal(
    (
      await runOne(async (options) => {
        assert.equal(options.input.kind, 'prompt')
        assert.match(options.input.roomContext ?? '', /播种-06:/u)
        assert.doesNotMatch(options.input.roomContext ?? '', /播种-05:/u)
        return faux(options)
      })
    ).status,
    'succeeded',
  )

  await appendRoomHistory('增量', 33, 55)
  const second = await post(`${roomPath}/messages`, { text: '继续对话', clientRequestId: randomUUID() }, adminUser)
  assert.equal(second.code, 'OK')
  assert.equal(
    (
      await runOne(async (options) => {
        assert.equal(options.input.kind, 'prompt')
        assert.match(options.input.roomContext ?? '', /上次回复以来的消息/u)
        assert.match(options.input.roomContext ?? '', /已省略 5 条更早的房间消息/u)
        assert.match(options.input.roomContext ?? '', /增量-05:/u)
        assert.doesNotMatch(options.input.roomContext ?? '', /增量-04:|疑似凭据/u)
        return faux(options)
      })
    ).status,
    'succeeded',
  )

  const [session] = await db
    .select({ id: botSession.id, cursor: botSession.synced_message_sequence })
    .from(botSession)
    .where(scope)
  assert.ok(session)
  assert.equal(session.cursor, BigInt(second.data.message.sequence))
  const entries = () =>
    db
      .select({
        id: botSessionEntry.entry_id,
        type: botSessionEntry.entry_type,
        content: botSessionEntry.content,
        source: botSessionEntry.source_message_id,
      })
      .from(botSessionEntry)
      .where(eq(botSessionEntry.session_id, session.id))
      .orderBy(botSessionEntry.sequence)
  const original = await entries()
  assert.ok(original.some(({ source }) => source === first.data.message.id))
  assert.ok(original.some(({ source }) => source === second.data.message.id))
  assert.doesNotMatch(JSON.stringify(original), new RegExp(secret, 'u'))
  const queued = await post(`${botPath}/compact`, {}, adminUser)
  assert.equal(queued.code, 'OK')
  const compacted = await runOne()
  assert.equal(compacted.status, 'succeeded', String(compacted.failure))
  assert.match(JSON.stringify(compacted.usage), /"outputTokens":\s*[1-9]/u)
  const after = await entries()
  assert.deepEqual(after.slice(0, original.length), original)
  assert.equal(after.at(-1)?.type, 'compaction')
  const trace = await get(`${roomPath}/events?runId=${queued.data.runId}`, adminUser)
  assert.equal(trace.code, 'OK')
  assert.match(JSON.stringify(trace.data.items), /compaction_started.*compaction_finished/u)

  await db.update(botSession).set({ format_version: 999 }).where(scope)
  assert.equal(
    (await post(`${roomPath}/messages`, { text: '检测损坏', clientRequestId: randomUUID() }, adminUser)).code,
    'OK',
  )
  assert.equal((await runOne()).failure, 'session_unavailable')
  assert.deepEqual(await entries(), after)
  assert.equal((await post(`${botPath}/reseed`, {}, adminUser)).code, 'OK')
  assert.deepEqual(await entries(), [])
  assert.equal(
    (await post(`${roomPath}/messages`, { text: '重新播种', clientRequestId: randomUUID() }, adminUser)).code,
    'OK',
  )
  assert.equal((await runOne()).status, 'succeeded')
})
