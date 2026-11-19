import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { createFauxBotRunner } from '@dev-ops/devops-bot/testing'
import { and, eq } from 'drizzle-orm'
import { createBotWorker } from '../../src/bootstrap/create-bot-worker.ts'
import {
  claimBotRun,
  enqueueBotRun,
  finishBotRun,
  reconcileExpiredBotRuns,
  renewBotRunLease,
} from '../../src/modules/bots/bots.run-queue.repository.ts'
import { bot, botModelConnection, botRun } from '../../src/modules/bots/bots.tables.ts'
import {
  botConversation,
  botConversationMember,
  botEvent,
  botMessage,
} from '../../src/modules/collaboration/bot-conversations.tables.ts'
import { authUser, team, teamMember } from '../../src/modules/identity/identity.tables.ts'
import { botTask } from '../../src/modules/tasks/bot-tasks.tables.ts'
import { createDatabase } from '../../src/platform/database/client.ts'
import { createBotTestDatabase } from '../support/bot-database.ts'

const limits = { global: 2, perTeam: 1, ttlSeconds: 30 }

test('Bot 租约跨进程遵守团队和全局限额，过期后旧代次不能写入', async (t) => {
  const { db, config, cleanup } = await createBotTestDatabase(t)
  const another = createDatabase(config, () => {})
  cleanup.push(another.close)
  const firstTeam = randomUUID()
  const firstConversation = randomUUID()
  const fixtureBot = randomUUID()
  const user = randomUUID()
  const [task] = await db
    .insert(botTask)
    .values({
      team_id: firstTeam,
      conversation_id: firstConversation,
      executor_bot_id: fixtureBot,
      title: '验证过期执行',
      acceptance_criteria: '失败后等待重新分配',
      business_owner_id: user,
      created_by: user,
    })
    .returning({ id: botTask.id })
  assert.ok(task)

  function enqueue(teamId: string, conversationId = randomUUID(), taskId?: string) {
    return db.transaction((tx) =>
      enqueueBotRun(tx, {
        team_id: teamId,
        conversation_id: conversationId,
        bot_id: fixtureBot,
        task_id: taskId,
        trigger_user_id: user,
        input_version: taskId ? 1 : 0,
      }),
    )
  }

  const first = await enqueue(firstTeam, firstConversation, task.id)
  const workers = Promise.all([claimBotRun(db, 'one', limits), claimBotRun(another.db, 'two', limits)])
  const claims = (await workers).filter((claim) => claim !== null)
  assert.equal(claims.length, 1)
  const [claimed] = claims
  assert.ok(claimed?.lease_owner)
  assert.equal(claimed.id, first.id)
  assert.equal(claimed.lease_epoch, 1)
  const lease = { id: first.id, owner: claimed.lease_owner, epoch: claimed.lease_epoch }
  assert.deepEqual(await renewBotRunLease(db, lease, limits.ttlSeconds), { stopRequested: false })
  assert.equal(await db.transaction((tx) => finishBotRun(tx, { ...lease, epoch: 0 }, { status: 'succeeded' })), null)

  const sameConversation = await enqueue(firstTeam, firstConversation)
  await enqueue(firstTeam)
  const anotherTeam = await enqueue(randomUUID())
  await enqueue(randomUUID())
  assert.equal((await claimBotRun(another.db, 'three', limits))?.id, anotherTeam.id)
  assert.equal(await claimBotRun(db, 'four', limits), null)
  assert.equal(
    await claimBotRun(db, 'four', { ...limits, global: 4, perTeam: 3 }).then((run) => run?.id === sameConversation.id),
    false,
  )

  await db
    .update(botRun)
    .set({ lease_until: new Date(0) })
    .where(eq(botRun.id, first.id))
  assert.equal(await renewBotRunLease(db, lease, 30), null)
  assert.equal(await reconcileExpiredBotRuns(db), 1)
  assert.equal(await reconcileExpiredBotRuns(another.db), 0)
  assert.equal(await db.transaction((tx) => finishBotRun(tx, lease, { status: 'succeeded' })), null)
  const [finished] = await db.select().from(botRun).where(eq(botRun.id, first.id))
  assert.equal(finished?.status, 'failed')
  assert.equal(finished.failure_kind, 'execution_interrupted')
  const [waiting] = await db.select().from(botTask).where(eq(botTask.id, task.id))
  assert.equal(waiting?.status, 'waiting')
  assert.equal(waiting.wait_reason, 'run_failed')
})

test('Bot 执行进程使用 faux 领取一次运行并提交回复、事件和用量', async (t) => {
  const { db, config, cleanup } = await createBotTestDatabase(t)
  const userId = randomUUID()
  const teamId = randomUUID()
  await db.insert(authUser).values({ id: userId, name: '测试成员', email: 'bot-fixture@example.test' })
  await db.insert(team).values({ id: teamId, name: '测试团队', created_by_user_id: userId })
  await db
    .insert(teamMember)
    .values({ id: randomUUID(), team_id: teamId, user_id: userId, role: 'developer', status: 'active' })
  const [connection] = await db
    .insert(botModelConnection)
    .values({
      team_id: teamId,
      name: '测试模型',
      provider_id: 'fixture',
      auth_type: 'api_key',
      credential_id: randomUUID(),
      status: 'active',
    })
    .returning()
  assert.ok(connection)
  const [botRow] = await db
    .insert(bot)
    .values({
      team_id: teamId,
      name: '测试 Bot',
      owner_user_id: userId,
      created_by: userId,
      responsibility: '回复夹具内容',
      model_connection_id: connection.id,
      model_id: 'fixture',
    })
    .returning()
  const [conversation] = await db
    .insert(botConversation)
    .values({
      team_id: teamId,
      kind: 'direct',
      name: '测试会话',
      created_by: userId,
    })
    .returning()
  assert.ok(botRow && conversation)
  await db.insert(botConversationMember).values([
    { team_id: teamId, conversation_id: conversation.id, member_id: userId, member_kind: 'user', added_by: userId },
    { team_id: teamId, conversation_id: conversation.id, member_id: botRow.id, member_kind: 'bot', added_by: userId },
  ])
  const [input] = await db
    .insert(botMessage)
    .values({
      team_id: teamId,
      conversation_id: conversation.id,
      sequence: 1n,
      speaker_kind: 'user',
      speaker_id: userId,
      body: { blocks: [{ type: 'text', text: '执行一次确定性测试' }] },
    })
    .returning()
  assert.ok(input)
  const run = await db.transaction((tx) =>
    enqueueBotRun(tx, {
      team_id: teamId,
      conversation_id: conversation.id,
      bot_id: botRow.id,
      trigger_user_id: userId,
      trigger_message_id: input.id,
      input_version: 0,
    }),
  )

  const failures: string[] = []
  const faux = createFauxBotRunner('验证通过')
  const worker = createBotWorker(
    config,
    async (options) => {
      const guidance = options.context.layers.find(({ title }) => title === '查询团队与用户数据')
      assert.match(guidance?.body ?? '', /get_current_context/)
      const currentContext = options.tools.find(({ name }) => name === 'get_current_context')
      assert.ok(currentContext)
      assert.equal((await currentContext.execute({ teamId: randomUUID() }, options.signal)).isError, true)
      const result = await currentContext.execute({}, options.signal)
      assert.equal(result.isError, undefined)
      assert.deepEqual(JSON.parse(result.text), { teamName: '测试团队', teamId, userId, role: 'developer' })
      for (const name of ['read', 'write', 'edit', 'bash', 'grep', 'find', 'ls', 'powershell']) {
        assert.ok(
          options.tools.some((tool) => tool.name === name),
          `默认工具缺少 ${name}`,
        )
      }
      assert.ok(
        options.context.layers.some((section) => section.title === '本地工作目录' && section.body.includes('沙盒')),
      )
      return faux(options)
    },
    (level, message) => {
      if (level === 'error') failures.push(message)
    },
  )
  cleanup.push(worker.close)
  await worker.pollOnce()
  let status = 'running'
  for (let attempt = 0; attempt < 30 && status === 'running'; attempt++) {
    const [record] = await db.select({ status: botRun.status }).from(botRun).where(eq(botRun.id, run.id))
    status = record?.status ?? 'missing'
    if (status === 'running') await delay(100)
  }
  assert.deepEqual(failures, [])
  assert.equal(status, 'succeeded')
  const [reply] = await db
    .select()
    .from(botMessage)
    .where(and(eq(botMessage.conversation_id, conversation.id), eq(botMessage.run_id, run.id)))
  assert.equal(reply?.sequence, 2n)
  assert.ok(reply)
  assert.ok(typeof reply.body === 'object' && reply.body !== null && 'blocks' in reply.body && 'metrics' in reply.body)
  assert.deepEqual(reply.body.blocks, [{ type: 'text', text: '验证通过' }])
  assert.ok(reply.body.metrics)
  const events = await db.select().from(botEvent).where(eq(botEvent.run_id, run.id)).orderBy(botEvent.sequence)
  const state = await db
    .select({ status: botRun.status, turns: botRun.turns, usage: botRun.usage })
    .from(botRun)
    .where(eq(botRun.id, run.id))
  assert.deepEqual(
    events.map(({ kind }) => kind),
    ['run_status', 'run_status', 'output_delta', 'run_status', 'message_committed'],
  )
  assert.equal(state[0]?.turns, 1)
  assert.ok(state[0]?.usage)
})
