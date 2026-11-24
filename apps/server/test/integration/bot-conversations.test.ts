import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { and, eq, lte } from 'drizzle-orm'
import { createHttpApp } from '../../src/bootstrap/create-http-app.ts'
import { publishBotModelCatalog } from '../../src/modules/bots/bots.catalog.ts'
import { isConversationBotRun, claimBotRun } from '../../src/modules/bots/bots.run-queue.repository.ts'
import { botModelCatalog } from '../../src/modules/bots/bots.tables.ts'
import { createConversationAttachmentTool } from '../../src/modules/bots/runtime/conversation-attachment-tool.ts'
import { createPgRunInputQueue } from '../../src/modules/bots/runtime/run-input-queue.ts'
import { createPgRunSink } from '../../src/modules/bots/runtime/run-sink.ts'
import { botEvent } from '../../src/modules/collaboration/bot-conversations.tables.ts'
import { platformAdmin, teamMember } from '../../src/modules/identity/identity.tables.ts'
import { createStorageService } from '../../src/modules/storage/storage.service.ts'
import { createBotTestDatabase } from '../support/bot-database.ts'
import { seedKnowledgeFixture } from '../support/knowledge-fixtures.ts'

test('Bot 私聊按成员范围隔离，消息重试复用运行，事件按增量读取', async (t) => {
  const { db, config, cleanup } = await createBotTestDatabase(t)
  const storageDir = await mkdtemp(join(tmpdir(), 'dev-ops-bot-attachments-test-'))
  cleanup.push(() => rm(storageDir, { recursive: true, force: true }))
  const app = createHttpApp({
    ...config,
    ATTACHMENT_STORAGE_DIR: storageDir,
    GIT_CREDENTIAL_ENCRYPTION_KEY: Buffer.alloc(32, 23).toString('base64'),
  })
  cleanup.push(() => app.close())
  const { adminUser, devUser, viewerUser, otherUser, teamId } = await seedKnowledgeFixture(app)
  const teamPath = `/api/v1/teams/${teamId}`
  async function get(url: string, user: { cookie: string }) {
    const response = await app.inject({ url, headers: { cookie: user.cookie } })
    assert.equal(response.statusCode, 200)
    return response.json()
  }
  async function post(url: string, user: { cookie: string }, payload: object, key = randomUUID()) {
    const response = await app.inject({
      url,
      payload,
      method: 'POST',
      headers: { cookie: user.cookie, 'idempotency-key': key },
    })
    assert.equal(response.statusCode, 200)
    return response.json()
  }

  await publishBotModelCatalog(db, [
    {
      providerId: 'fixture',
      modelId: 'test-chat',
      displayName: '测试模型',
      authTypes: ['api_key'],
      contextWindow: 8192,
    },
  ])
  const created = await post(`${teamPath}/bots`, devUser, {
    name: '协作助理',
    responsibility: '测试私聊',
    avatarKey: 'prism',
    ownerUserId: devUser.userId,
  })
  assert.equal(created.code, 'OK', created.message)
  const botId = String(created.data.id)
  const connection = await post(`${teamPath}/bot-model-connections`, adminUser, {
    name: '测试连接',
    providerId: 'fixture',
    apiKey: 'fixture-only',
  })
  assert.equal(connection.code, 'OK', connection.message)
  const binding = await post(`/api/v1/bots/${botId}/bind-model`, adminUser, {
    configVersion: 1,
    connectionId: connection.data.id,
    modelId: 'test-chat',
  })
  assert.equal(binding.code, 'OK', binding.message)

  const listPath = `${teamPath}/bot-conversations`
  const input = { kind: 'direct', botId }
  assert.equal((await post(listPath, viewerUser, input)).code, 'FORBIDDEN')
  const [opened, repeated] = await Promise.all([post(listPath, devUser, input), post(listPath, devUser, input)])
  assert.equal(opened.code, 'OK', opened.message)
  assert.equal(repeated.data.id, opened.data.id)
  const roomId = String(opened.data.id)
  const roomPath = `/api/v1/bot-conversations/${roomId}`
  const initialList = (await get(listPath, devUser)).data.items
  assert.equal(initialList.length, 1)
  assert.deepEqual(initialList[0].botAvatars, [{ id: botId, avatarKey: 'prism', enabled: true }])
  assert.equal(initialList[0].lastMessagePreview, null)
  assert.deepEqual((await get(listPath, adminUser)).data.items, [])
  assert.equal((await get(roomPath, adminUser)).code, 'BOT_CONVERSATION_NOT_FOUND')
  await db.insert(platformAdmin).values({ user_id: otherUser.userId })
  assert.equal((await get(roomPath, otherUser)).code, 'BOT_CONVERSATION_NOT_FOUND')

  const freshRoom = await post(listPath, devUser, { ...input, newSession: true })
  assert.equal(freshRoom.code, 'OK', freshRoom.message)
  assert.notEqual(freshRoom.data.id, roomId)
  assert.equal((await post(listPath, devUser, input)).data.id, freshRoom.data.id)

  const messagePath = `${roomPath}/messages`
  const message = { text: '第一条消息', clientRequestId: randomUUID() }
  const [first, duplicate] = await Promise.all([
    post(messagePath, devUser, message, message.clientRequestId),
    post(messagePath, devUser, message, message.clientRequestId),
  ])
  assert.equal(first.code, 'OK', first.message)
  assert.equal(first.data.runId, duplicate.data.runId)
  assert.equal((await post(messagePath, devUser, { ...message, mentionBotIds: [botId] })).code, 'IDEMPOTENCY_CONFLICT')
  assert.equal(
    (await post(messagePath, devUser, { ...message, clientRequestId: randomUUID(), mentionBotIds: [randomUUID()] }))
      .code,
    'BOT_NOT_FOUND',
  )
  const second = await post(messagePath, devUser, {
    text: '**第二条消息**\n\n```ts\nconst ignored = true\n```',
    clientRequestId: randomUUID(),
  })
  assert.equal(second.code, 'OK')
  assert.equal((await get(listPath, devUser)).data.items[0].lastMessagePreview, '第二条消息')
  const page = await get(`${messagePath}?limit=1`, devUser)
  assert.equal(page.data.items[0].id, second.data.message.id)
  assert.equal(
    (await get(`${messagePath}?before=${page.data.nextBefore}`, devUser)).data.items[0].id,
    first.data.message.id,
  )

  const claimed = await claimBotRun(db, 'chat-test', { global: 5, perTeam: 5, ttlSeconds: 30 })
  assert.ok(claimed && isConversationBotRun(claimed))
  assert.equal(claimed.id, first.data.runId)
  assert.equal(await claimBotRun(db, 'chat-test-2', { global: 5, perTeam: 5, ttlSeconds: 30 }), null)
  const eventsPath = `${roomPath}/events`
  const events = await get(eventsPath, devUser)
  assert.deepEqual(
    events.data.activeRuns.map((run: { status: string }) => run.status),
    ['running', 'queued'],
  )
  const sink = createPgRunSink(db, claimed, { id: claimed.id, owner: 'chat-test', epoch: claimed.lease_epoch }, () => {
    assert.fail('运行事件写入失败')
  })
  const delta = { type: 'output_delta', seq: 1, payload: { text: '回复片段' } } as const
  await sink.emit(delta)
  await sink.emit(delta)
  await sink.flush()
  const incremental = await get(`${eventsPath}?after=${events.data.cursor}`, devUser)
  assert.equal(incremental.data.items.length, 1)
  assert.equal(incremental.data.items[0].payload.text, '回复片段')
  const firstTrace = await get(`${eventsPath}?runId=${claimed.id}`, devUser)
  assert.deepEqual(
    firstTrace.data.items.map(({ runId }: { runId: string }) => runId),
    [claimed.id, claimed.id, claimed.id],
  )
  assert.deepEqual(firstTrace.data.activeRuns, [{ id: claimed.id, botId, status: 'running' }])
  const secondTrace = await get(`${eventsPath}?runId=${second.data.runId}&after=1`, devUser)
  assert.equal(secondTrace.data.items.length, 1)
  assert.equal(secondTrace.data.items[0].runId, second.data.runId)
  assert.equal(secondTrace.data.resetRequired, false)
  assert.equal((await get(`${eventsPath}?runId=${claimed.id}`, otherUser)).code, 'BOT_CONVERSATION_NOT_FOUND')
  await db.delete(botEvent).where(and(eq(botEvent.conversation_id, roomId), lte(botEvent.sequence, 2n)))
  const stale = await get(`${eventsPath}?after=1`, devUser)
  assert.equal(stale.data.resetRequired, true)
  assert.equal((await get(`${eventsPath}?after=9999999999999999999`, devUser)).code, 'VALIDATION_ERROR')

  await db
    .update(botModelCatalog)
    .set({ reported_at: new Date(0) })
    .where(eq(botModelCatalog.provider_id, 'fixture'))
  const whileOffline = await post(messagePath, devUser, { text: '离线时仍可发送', clientRequestId: randomUUID() })
  assert.equal(whileOffline.code, 'OK', whileOffline.message)
  assert.equal(whileOffline.data.delivery, 'follow_up')
  assert.equal(whileOffline.data.runId, claimed.id)
  const queued = (await get(eventsPath, devUser)).data.activeRuns
  assert.deepEqual(queued, [
    { id: first.data.runId, botId, status: 'running' },
    { id: second.data.runId, botId, status: 'queued', teamQueuePosition: 1, queueReason: 'worker_offline' },
  ])

  const file = Buffer.from('这是只在当前会话共享的附件')
  const fileName = '验收记录.md'
  async function upload(user: { cookie: string }) {
    const response = await app.inject({
      method: 'POST',
      url: `${roomPath}/attachments`,
      payload: file,
      headers: {
        cookie: user.cookie,
        'content-type': 'application/octet-stream',
        'x-file-name': encodeURIComponent(fileName),
        'x-file-type': 'text/markdown',
        'content-length': String(file.length),
      },
    })
    assert.equal(response.statusCode, 200)
    return response.json()
  }

  assert.equal((await upload(adminUser)).code, 'BOT_CONVERSATION_NOT_FOUND')
  const uploaded = await upload(devUser)
  assert.equal(uploaded.code, 'OK', uploaded.message)
  const attachmentId = String(uploaded.data.attachment.id)
  assert.equal((await get(`/api/v1/attachments/${attachmentId}/download`, devUser)).code, 'ATTACHMENT_NOT_FOUND')
  const attachmentsInput = {
    text: '',
    deliveryMode: 'steer',
    clientRequestId: randomUUID(),
    attachmentIds: [attachmentId],
  }
  assert.equal(
    (await post(messagePath, devUser, { ...attachmentsInput, attachmentIds: [attachmentId, randomUUID()] })).code,
    'ATTACHMENT_NOT_FOUND',
  )
  const [attached, sameAttachment] = await Promise.all([
    post(messagePath, devUser, attachmentsInput),
    post(messagePath, devUser, attachmentsInput),
  ])
  assert.equal(attached.code, 'OK', attached.message)
  assert.equal(attached.data.message.id, sameAttachment.data.message.id)
  assert.equal(attached.data.delivery, 'steer')
  assert.deepEqual(attached.data.message.body.attachments, [{ id: attachmentId, fileName, sizeBytes: file.length }])
  const messageId = String(attached.data.message.id)
  const download = await app.inject({
    url: `${messagePath}/${messageId}/attachments/${attachmentId}/download`,
    headers: { cookie: devUser.cookie },
  })
  assert.deepEqual(download.rawPayload, file)
  assert.equal(download.headers['x-content-sha256'], createHash('sha256').update(file).digest('hex'))
  assert.equal(
    (await get(`${messagePath}/${messageId}/attachments/${attachmentId}/download`, adminUser)).code,
    'BOT_CONVERSATION_NOT_FOUND',
  )
  assert.equal(
    (await get(`${messagePath}/${first.data.message.id}/attachments/${attachmentId}/download`, devUser)).code,
    'ATTACHMENT_NOT_FOUND',
  )
  assert.equal((await post(`/api/v1/attachments/${attachmentId}/remove`, devUser, {})).code, 'ATTACHMENT_NOT_FOUND')

  const withdrawDraft = await post(messagePath, devUser, { text: '撤回前不执行', clientRequestId: randomUUID() })
  const withdrawId = String(withdrawDraft.data.message.id)
  const queueBefore = await get(`${roomPath}/queued-inputs`, devUser)
  assert.ok(queueBefore.data.items.some((item: { messageId: string }) => item.messageId === withdrawId))
  assert.equal((await get(`${roomPath}/queued-inputs`, adminUser)).code, 'BOT_CONVERSATION_NOT_FOUND')
  assert.equal((await post(`${messagePath}/${withdrawId}/withdraw`, adminUser, {})).code, 'BOT_CONVERSATION_NOT_FOUND')
  const withdrawn = await post(`${messagePath}/${withdrawId}/withdraw`, devUser, {})
  assert.equal(withdrawn.code, 'OK', withdrawn.message)
  assert.equal(withdrawn.data.text, '撤回前不执行')
  assert.equal((await post(`${messagePath}/${withdrawId}/withdraw`, devUser, {})).code, 'VERSION_CONFLICT')
  const queueAfter = await get(`${roomPath}/queued-inputs`, devUser)
  assert.ok(!queueAfter.data.items.some((item: { messageId: string }) => item.messageId === withdrawId))
  assert.equal((await get(`${roomPath}/usage`, devUser)).code, 'OK')
  assert.equal((await get(`${roomPath}/usage`, adminUser)).code, 'BOT_CONVERSATION_NOT_FOUND')

  const lease = { id: claimed.id, owner: 'chat-test', epoch: claimed.lease_epoch }
  const pending = await createPgRunInputQueue(db, claimed, lease).take({ allowFollowUp: true })
  assert.ok(pending.some((item) => item.messageId === messageId && item.text.includes(attachmentId)))
  const storage = createStorageService({
    db,
    cipher: null,
    config: { localDir: storageDir, probeTimeoutMs: config.STORAGE_PROBE_TIMEOUT_MS },
  })
  const tool = createConversationAttachmentTool(db, claimed, lease, storage)
  const signal = new AbortController().signal
  assert.deepEqual(await tool.execute({ messageId, attachmentId }, signal), { text: `${fileName}\n${file.toString()}` })
  assert.equal((await tool.execute({ messageId: first.data.message.id, attachmentId }, signal)).isError, true)

  const usage = { inputTokens: 32, outputTokens: 12, cacheReadTokens: 8, cacheWriteTokens: 0, costUsd: 0.001 }
  assert.equal(
    await sink.finish({
      status: 'succeeded',
      turns: 1,
      usage,
      finalMessage: { role: 'assistant', blocks: [{ type: 'text', text: '最终回复' }] },
    }),
    true,
  )
  const requeued = (await get(messagePath, devUser)).data.items.find(
    (item: { id: string }) => item.id === whileOffline.data.message.id,
  )
  assert.ok(requeued)
  assert.notEqual(requeued.runId, claimed.id)
  assert.ok(
    (await get(eventsPath, devUser)).data.activeRuns.some(
      (item: { id: string; status: string }) => item.id === requeued.runId && item.status === 'queued',
    ),
  )
  const saved = (await get(messagePath, devUser)).data.items.find(
    (item: { speakerKind: string }) => item.speakerKind === 'bot',
  )
  assert.ok(saved)
  assert.equal(saved.body.metrics.inputTokens, 32)
  assert.equal(saved.body.metrics.turns, 1)
  const feedbackPath = `${messagePath}/${saved.id}/feedback`
  assert.equal((await post(feedbackPath, adminUser, { rating: 'helpful' })).code, 'BOT_CONVERSATION_NOT_FOUND')
  assert.equal(
    (await post(`${messagePath}/${first.data.message.id}/feedback`, devUser, { rating: 'helpful' })).code,
    'VALIDATION_ERROR',
  )
  const votes = await Promise.all([
    post(feedbackPath, devUser, { rating: 'helpful' }),
    post(feedbackPath, devUser, { rating: 'helpful' }),
  ])
  assert.ok(votes.every((vote) => vote.code === 'OK'))
  assert.equal(
    (await get(messagePath, devUser)).data.items.find((item: { id: string }) => item.id === saved.id).feedback,
    'helpful',
  )
  assert.equal((await post(feedbackPath, devUser, { rating: 'unhelpful' })).data.rating, 'unhelpful')
  assert.equal((await post(feedbackPath, devUser, { rating: null })).data.rating, null)
  assert.equal(
    (await get(messagePath, devUser)).data.items.find((item: { id: string }) => item.id === saved.id).feedback,
    null,
  )
  assert.equal(saved.body.metrics.outputTokens, 12)

  await db.update(teamMember).set({ role: 'viewer' }).where(eq(teamMember.user_id, devUser.userId))
  assert.equal((await post(feedbackPath, devUser, { rating: 'helpful' })).code, 'FORBIDDEN')
  assert.equal((await get(messagePath, devUser)).code, 'OK')
  assert.equal((await upload(devUser)).code, 'FORBIDDEN')
  assert.equal((await post(messagePath, devUser, { ...message, clientRequestId: randomUUID() })).code, 'FORBIDDEN')
  assert.equal((await get(eventsPath, otherUser)).code, 'BOT_CONVERSATION_NOT_FOUND')
})
