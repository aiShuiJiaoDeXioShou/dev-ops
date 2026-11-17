import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { and, eq } from 'drizzle-orm'
import { createHttpApp } from '../../src/bootstrap/create-http-app.ts'
import { enqueueBotRun, claimBotRun, renewBotRunLease } from '../../src/modules/bots/bots.run-queue.repository.ts'
import { requireRunnableBot } from '../../src/modules/bots/bots.service.ts'
import { botModelCatalog, botModelConnection, botRun } from '../../src/modules/bots/bots.tables.ts'
import { credential } from '../../src/modules/configuration/configuration.tables.ts'
import { teamMember } from '../../src/modules/identity/identity.tables.ts'
import { botTask } from '../../src/modules/tasks/bot-tasks.tables.ts'
import { ApiError } from '../../src/platform/http/errors.ts'
import { createBotTestDatabase } from '../support/bot-database.ts'
import { seedKnowledgeFixture } from '../support/knowledge-fixtures.ts'

test('Bot 配置满足团队和角色约束，停用阻止新运行并收口现有任务', async (t) => {
  const { db, config, cleanup } = await createBotTestDatabase(t)
  const app = createHttpApp(config)
  cleanup.push(() => app.close())
  const { adminUser, devUser, viewerUser, otherUser, teamId } = await seedKnowledgeFixture(app)
  const list = `/api/v1/teams/${teamId}/bots`
  const input = { name: '项目助理', responsibility: '整理任务', ownerUserId: viewerUser.userId }
  async function post(url: string, user: { cookie: string }, payload: object) {
    const response = await app.inject({
      method: 'POST',
      url,
      payload,
      headers: {
        cookie: user.cookie,
        'idempotency-key': randomUUID(),
      },
    })
    assert.equal(response.statusCode, 200)
    return response.json()
  }

  assert.equal((await post(list, viewerUser, input)).code, 'FORBIDDEN')
  assert.equal((await post(list, devUser, { ...input, ownerUserId: otherUser.userId })).code, 'VALIDATION_ERROR')
  const created = await post(list, devUser, input)
  assert.equal(created.code, 'OK', created.message)
  assert.equal(created.data.availability, 'model_unbound')
  const botId = String(created.data.id)
  const detail = `/api/v1/bots/${botId}`
  assert.equal((await app.inject({ url: detail, headers: { cookie: otherUser.cookie } })).json().code, 'BOT_NOT_FOUND')
  assert.equal((await app.inject({ url: detail, headers: { cookie: viewerUser.cookie } })).json().data.id, botId)
  const found = await app.inject({
    url: `${list}?query=${encodeURIComponent('助理')}&ownerUserId=${viewerUser.userId}`,
    headers: { cookie: viewerUser.cookie },
  })
  assert.equal(found.json().data.items.length, 1)
  assert.equal((await post(`${detail}/update`, viewerUser, { ...input, configVersion: 1 })).code, 'FORBIDDEN')
  const edited = await post(`${detail}/update`, devUser, { ...input, configVersion: 1, responsibility: '整理验收结果' })
  assert.equal(edited.data.responsibility, '整理验收结果')
  assert.equal((await post(`${detail}/update`, devUser, { ...input, configVersion: 1 })).code, 'VERSION_CONFLICT')
  await db
    .update(teamMember)
    .set({ status: 'disabled' })
    .where(and(eq(teamMember.team_id, teamId), eq(teamMember.user_id, viewerUser.userId)))
  assert.equal((await post(`${detail}/update`, devUser, { ...input, configVersion: 2 })).code, 'VALIDATION_ERROR')

  const keyId = randomUUID()
  await db.insert(credential).values({
    id: keyId,
    team_id: teamId,
    name: '测试密钥',
    kind: 'model_api_key',
    status: 'active',
    created_by_user_id: adminUser.userId,
  })
  const [connection] = await db
    .insert(botModelConnection)
    .values({
      team_id: teamId,
      name: '测试连接',
      provider_id: 'fixture',
      auth_type: 'api_key',
      credential_id: keyId,
      status: 'active',
    })
    .returning()
  assert.ok(connection)
  await db.insert(botModelCatalog).values({
    provider_id: 'fixture',
    model_id: 'fixture-chat',
    display_name: '夹具模型',
    auth_types: ['api_key'],
    reported_at: new Date(),
  })
  const binding = { configVersion: 2, connectionId: connection.id, modelId: 'fixture-chat' }
  assert.equal((await post(`${detail}/bind-model`, devUser, binding)).code, 'FORBIDDEN')
  const bound = await post(`${detail}/bind-model`, adminUser, binding)
  assert.equal(bound.code, 'OK', bound.message)
  assert.equal(bound.data.availability, 'available')
  assert.equal(JSON.stringify(bound).includes(connection.credential_id ?? 'broken fixture'), false)

  const [task] = await db
    .insert(botTask)
    .values({
      team_id: teamId,
      conversation_id: randomUUID(),
      executor_bot_id: botId,
      title: '测试任务',
      acceptance_criteria: '验证停用后的阻塞状态',
      business_owner_id: adminUser.userId,
      created_by: devUser.userId,
    })
    .returning()
  assert.ok(task)
  const [current, queued] = await db.transaction(async (tx) => [
    await enqueueBotRun(tx, {
      team_id: teamId,
      bot_id: botId,
      conversation_id: task.conversation_id,
      task_id: task.id,
      trigger_user_id: devUser.userId,
      input_version: 1,
    }),
    await enqueueBotRun(tx, {
      team_id: teamId,
      bot_id: botId,
      conversation_id: task.conversation_id,
      trigger_user_id: devUser.userId,
      input_version: 0,
    }),
  ])
  const leased = await claimBotRun(db, 'test-worker', { global: 1, perTeam: 1, ttlSeconds: 30 })
  assert.equal(leased?.id, current.id)
  const disabled = await post(`${detail}/disable`, devUser, { configVersion: 3 })
  assert.equal(disabled.data.availability, 'disabled')
  assert.deepEqual(await renewBotRunLease(db, { id: current.id, owner: 'test-worker', epoch: 1 }, 30), {
    stopRequested: true,
  })
  const [stopped] = await db.select({ status: botRun.status }).from(botRun).where(eq(botRun.id, queued.id))
  assert.equal(stopped?.status, 'stopped')
  const [blocked] = await db
    .select({ blocked: botTask.blocked, reason: botTask.wait_reason })
    .from(botTask)
    .where(eq(botTask.id, task.id))
  assert.deepEqual(blocked, { blocked: true, reason: 'executor_unavailable' })
  await assert.rejects(
    db.transaction((tx) => requireRunnableBot(tx, teamId, botId)),
    (error) => error instanceof ApiError && error.code === 'BOT_UNAVAILABLE',
  )
})
