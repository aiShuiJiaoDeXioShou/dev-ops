import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createFauxBotRunner } from '@dev-ops/devops-bot/testing'
import { and, eq } from 'drizzle-orm'
import { createHttpApp } from '../../src/bootstrap/create-http-app.ts'
import { teamBotBudget } from '../../src/modules/bots/bots.platform.tables.ts'
import { claimBotRun } from '../../src/modules/bots/bots.run-queue.repository.ts'
import { bot, botRun } from '../../src/modules/bots/bots.tables.ts'
import { executeClaimedBotRun, type BotRunner } from '../../src/modules/bots/runtime/execute-run.ts'
import { botRoomRelay } from '../../src/modules/collaboration/bot-relay.tables.ts'
import { createBotTestDatabase } from '../support/bot-database.ts'
import { seedBotWorkflowFixture } from '../support/bot-workflow-fixtures.ts'

test('群聊点名、全员、接力暂停与成员控制使用同一运行队列', async (t) => {
  const { db, config: base, cleanup } = await createBotTestDatabase(t)
  const directory = await mkdtemp(join(tmpdir(), 'devops-bot-relay-'))
  cleanup.push(() => rm(directory, { recursive: true, force: true }))
  const config = {
    ...base,
    BOT_WORKSPACE_DIR: directory,
    BOT_RELAY_HOP_LIMIT: 2,
    GIT_CREDENTIAL_ENCRYPTION_KEY: Buffer.alloc(32, 77).toString('base64'),
  }
  const app = createHttpApp(config)
  cleanup.push(() => app.close())
  const {
    teamId,
    teamPath,
    botId: leader,
    devUser,
    adminUser,
    viewerUser,
    post,
    get,
  } = await seedBotWorkflowFixture(app)
  const original = await get(`/bots/${leader}`)
  async function createPeer(name: string): Promise<string> {
    const made = await post(`${teamPath}/bots`, { name, responsibility: '回复群聊', ownerUserId: devUser.userId })
    assert.equal(made.code, 'OK')
    const id = String(made.data.id)
    const bound = await post(
      `/bots/${id}/bind-model`,
      {
        configVersion: made.data.configVersion,
        connectionId: original.data.modelConnectionId,
        modelId: original.data.modelId,
      },
      adminUser,
    )
    assert.equal(bound.code, 'OK')
    return id
  }
  const peer = await createPeer('复核员')
  const third = await createPeer('发布员')
  const opened = await post(`${teamPath}/bot-conversations`, {
    kind: 'group',
    name: '接力夹具',
    leaderBotId: leader,
    botIds: [leader, peer, third],
    memberUserIds: [adminUser.userId, viewerUser.userId],
  })
  assert.equal(opened.code, 'OK', opened.message)
  const room = `/bot-conversations/${opened.data.id}`
  const send = (text: string, target?: string[], all?: boolean) =>
    post(`${room}/messages`, {
      clientRequestId: randomUUID(),
      text,
      mentionBotIds: target,
      mentionAll: all,
    })
  const active = async () => (await get(room)).data.activeRelay
  const rowOf = async (id: string) => {
    const [row] = await db.select().from(botRoomRelay).where(eq(botRoomRelay.id, id))
    assert.ok(row)
    return row
  }
  const claim = () => claimBotRun(db, 'relay-fixture', { global: 2, perTeam: 2, ttlSeconds: 30 })
  async function execute(botId: string, execute: BotRunner = createFauxBotRunner('已收到')) {
    const run = await claim()
    assert.ok(run)
    assert.equal(run.bot_id, botId)
    await executeClaimedBotRun(
      { db, config, cipher: null, execute, onFailure: () => assert.fail('群聊 Worker 报错') },
      run,
      new AbortController().signal,
    )
    return run
  }

  const first = await send('默认给负责人')
  assert.equal(first.code, 'OK')
  await execute(leader, createFauxBotRunner('@任务助理 自己检查'))
  assert.equal((await rowOf(first.data.relay.id)).status, 'finished')

  const multi = await send('按顺序处理', [third, peer, third])
  assert.equal(multi.code, 'OK')
  assert.deepEqual(multi.data.relay.pendingBotIds, [peer])
  await execute(third, createFauxBotRunner('发布员提供了新结论'))
  await execute(peer, (options) => {
    assert.equal(options.input.kind, 'prompt')
    assert.match(options.input.roomContext ?? '', /发布员提供了新结论/u)
    return createFauxBotRunner('已复核前一位结论')(options)
  })
  assert.equal((await rowOf(multi.data.relay.id)).reply_count, 2)

  const all = await send('@全部 查看状态')
  assert.equal(all.code, 'OK')
  const firstAll = await claim()
  assert.ok(firstAll && firstAll.relay_role === 'all')
  await executeClaimedBotRun(
    {
      db,
      config,
      cipher: null,
      onFailure: () => assert.fail('跳过运行报错'),
      async execute(options) {
        assert.equal(options.room?.allowSkip, true)
        const outcome = await createFauxBotRunner('跳过')(options)
        assert.equal(outcome.status, 'succeeded')
        return { ...outcome, skipped: true }
      },
    },
    firstAll,
    new AbortController().signal,
  )
  await db.update(bot).set({ status: 'disabled' }).where(eq(bot.id, all.data.relay.pendingBotIds[0]))
  for (const id of all.data.relay.pendingBotIds) await execute(id)
  const messages = (await get(`${room}/messages`)).data.items
  assert.ok(messages.some((message: { speakerKind: string }) => message.speakerKind === 'system'))
  assert.ok(
    !messages.some(
      (message: { runId: string; speakerKind: string }) =>
        message.runId === firstAll.id && message.speakerKind === 'bot',
    ),
  )
  await db
    .update(bot)
    .set({ status: 'enabled' })
    .where(and(eq(bot.id, all.data.relay.pendingBotIds[0]), eq(bot.team_id, teamId)))

  const chain = await send('发起接力', [leader])
  assert.equal(chain.code, 'OK')
  await execute(leader, createFauxBotRunner('@复核员 继续'))
  await execute(peer, createFauxBotRunner('@任务助理 继续'))
  await execute(leader, createFauxBotRunner('@复核员 继续'))
  const paused = await active()
  assert.equal(paused.status, 'paused')
  assert.equal(paused.hopCount, 2)
  assert.equal(await claim(), null)
  assert.equal(
    (await post(`/bot-relays/${paused.id}/continue`, { version: paused.version }, viewerUser)).code,
    'FORBIDDEN',
  )
  assert.equal(
    (await post(`/bot-relays/${paused.id}/continue`, { version: paused.version - 1 }, adminUser)).code,
    'BOT_RELAY_STATE_CONFLICT',
  )
  const continued = await post(`/bot-relays/${paused.id}/continue`, { version: paused.version }, adminUser)
  assert.equal(continued.code, 'OK', continued.message)
  assert.equal(continued.data.continueCount, 1)
  const resumed = await claim()
  assert.ok(resumed && resumed.bot_id === peer && resumed.trigger_user_id === adminUser.userId)
  const stopped = await post(`/bot-relays/${paused.id}/stop`, { version: continued.data.version }, adminUser)
  assert.equal(stopped.data.status, 'stopped')
  const [stoppedRun] = await db.select().from(botRun).where(eq(botRun.id, resumed.id))
  assert.equal(stoppedRun?.stop_requested, true)

  await executeClaimedBotRun(
    {
      db,
      config,
      cipher: null,
      onFailure: () => assert.fail('停止时运行报错'),
      execute: createFauxBotRunner('停止后不发'),
    },
    resumed,
    new AbortController().signal,
  )
  assert.equal(await active(), undefined)

  const exhausted = await send('预算检查', [leader, peer])
  await db.insert(teamBotBudget).values({ team_id: teamId, monthly_limit_usd: '0', updated_by: adminUser.userId })
  assert.equal(await claim(), null)
  assert.equal((await rowOf(exhausted.data.relay.id)).end_reason, 'budget_exhausted')
})
