import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { eq } from 'drizzle-orm'
import { createHttpApp } from '../../src/bootstrap/create-http-app.ts'
import { botRun } from '../../src/modules/bots/bots.tables.ts'
import { createBotTestDatabase } from '../support/bot-database.ts'
import { seedBotWorkflowFixture } from '../support/bot-workflow-fixtures.ts'

test('群组按 Leader 或唯一引用路由，移出成员即拒绝读取，转交保留已有历史', async (t) => {
  const { db, config, cleanup } = await createBotTestDatabase(t)
  const app = createHttpApp({ ...config, GIT_CREDENTIAL_ENCRYPTION_KEY: Buffer.alloc(32, 90).toString('base64') })
  cleanup.push(() => app.close())
  const { adminUser, devUser, viewerUser, otherUser, teamPath, botId, post, get } = await seedBotWorkflowFixture(app)
  const original = await get(`/bots/${botId}`)
  const createdBot = await post(`${teamPath}/bots`, {
    name: '复核 Bot',
    responsibility: '复核交付',
    ownerUserId: devUser.userId,
  })
  assert.equal(createdBot.code, 'OK', createdBot.message)
  const otherBotId = String(createdBot.data.id)
  const otherBotPath = `/bots/${otherBotId}`
  const binding = await post(
    otherBotPath + '/bind-model',
    {
      configVersion: createdBot.data.configVersion,
      connectionId: original.data.modelConnectionId,
      modelId: original.data.modelId,
    },
    adminUser,
  )
  assert.equal(binding.code, 'OK', binding.message)
  const create = await post(`${teamPath}/bot-conversations`, {
    kind: 'group',
    name: '验收群组',
    leaderBotId: botId,
    botIds: [botId, otherBotId],
    memberUserIds: [],
  })
  assert.equal(create.code, 'OK', create.message)
  const conversationId = String(create.data.id)
  const room = `/bot-conversations/${conversationId}`
  const messages = `${room}/messages`
  const first = await post(messages, { clientRequestId: randomUUID(), text: '查看任务状态' })
  const second = await post(messages, { clientRequestId: randomUUID(), text: '@复核 Bot 帮忙复核' })
  assert.equal(first.code, 'OK', first.message)
  assert.equal(second.code, 'OK', second.message)
  for (const [runId, receiver] of [
    [first.data.runId, botId],
    [second.data.runId, otherBotId],
  ]) {
    const [row] = await db
      .select({ id: botRun.bot_id })
      .from(botRun)
      .where(eq(botRun.id, String(runId)))
    assert.equal(row?.id, receiver)
  }
  const ambiguous = await post(messages, { clientRequestId: randomUUID(), text: '@任务助理 @复核 Bot 核对' })
  assert.equal(ambiguous.code, 'BOT_MENTION_AMBIGUOUS')
  assert.equal((await get(room, viewerUser)).code, 'BOT_CONVERSATION_NOT_FOUND')
  assert.equal(
    (await post(`${room}/members/add`, { kind: 'user', memberId: otherUser.userId })).code,
    'VALIDATION_ERROR',
  )
  assert.equal((await post(`${room}/members/add`, { kind: 'user', memberId: viewerUser.userId })).code, 'OK')
  assert.equal((await get(messages, viewerUser)).data.items.length, 2)
  assert.equal(
    (await post(messages, { clientRequestId: randomUUID(), text: '尝试发送' }, viewerUser)).code,
    'FORBIDDEN',
  )

  const generated = await post(`${room}/tasks`, {
    title: '验证交付',
    acceptanceCriteria: '保留证据',
    businessOwnerId: devUser.userId,
  })
  assert.equal(generated.code, 'OK', generated.message)
  assert.equal(generated.data.task.executorBotId, botId)
  const taskPath = `/bot-tasks/${generated.data.task.id}`
  assert.equal((await post(`${room}/update`, { leaderBotId: otherBotId })).data.leaderBotId, otherBotId)
  assert.equal((await get(taskPath)).data.executorBotId, botId)
  assert.equal((await post(`${room}/members/remove`, { kind: 'bot', memberId: botId })).code, 'OK')
  const blocked = (await get(taskPath)).data
  assert.equal(blocked.blocked, true)
  assert.equal(blocked.runs[0].status, 'stopped')
  assert.equal(blocked.waitReason, 'executor_unavailable')
  const handed = await post(`${taskPath}/handoff`, {
    toBotId: otherBotId,
    version: blocked.version,
    reason: '原执行者已移出',
    summary: '保留验收记录',
    unfinished: '补充日期',
  })
  assert.equal(handed.code, 'OK', handed.message)
  assert.equal(handed.data.task.executorBotId, otherBotId)
  assert.equal(handed.data.task.blocked, false)
  const history = (await get(taskPath)).data
  assert.equal(history.handoffs[0].fromBotId, botId)
  assert.equal(history.handoffs[0].toBotId, otherBotId)
  assert.equal(history.runs.length, 2)
  assert.equal((await post(`${room}/members/remove`, { kind: 'user', memberId: viewerUser.userId })).code, 'OK')
  assert.equal((await get(messages, viewerUser)).code, 'BOT_CONVERSATION_NOT_FOUND')
  const disabled = await post(otherBotPath + '/disable', { configVersion: binding.data.configVersion }, devUser)
  assert.equal(disabled.code, 'OK', disabled.message)
  assert.equal((await post(messages, { clientRequestId: randomUUID(), text: '默认承接' })).code, 'BOT_NO_RECEIVER')
})
