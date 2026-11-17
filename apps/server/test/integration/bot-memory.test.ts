import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { test } from 'node:test'
import { createHttpApp } from '../../src/bootstrap/create-http-app.ts'
import { claimBotRun } from '../../src/modules/bots/bots.run-queue.repository.ts'
import { botMemory } from '../../src/modules/bots/bots.tables.ts'
import { teamMember } from '../../src/modules/identity/identity.tables.ts'
import { loadBotRunContext } from '../../src/modules/bots/runtime/context.ts'
import { createPgMemoryStore } from '../../src/modules/bots/runtime/memory-store.ts'
import { createBotTestDatabase } from '../support/bot-database.ts'
import { seedBotWorkflowFixture } from '../support/bot-workflow-fixtures.ts'

test('长期记忆按触发人隔离、支持中文搜索、拒绝凭据并遵守容量', async (t) => {
  const { db, config, cleanup } = await createBotTestDatabase(t)
  const app = createHttpApp({ ...config, GIT_CREDENTIAL_ENCRYPTION_KEY: Buffer.alloc(32, 75).toString('base64') })
  cleanup.push(() => app.close())
  const { adminUser, devUser, viewerUser, otherUser, botId, teamPath, roomPath, post, get } =
    await seedBotWorkflowFixture(app)
  const path = `${teamPath}/bot-memories`
  const draft = { botId, scope: 'user', content: '交付回复用中文简述', essential: true }
  assert.equal((await post(path, draft, viewerUser)).code, 'FORBIDDEN')
  assert.equal((await post(path, { ...draft, content: `sk-${'fixture'.repeat(5)}` })).code, 'BOT_MEMORY_SECRET')
  const created = await post(path, draft)
  assert.equal(created.code, 'OK', created.message)
  const profileId = String(created.data.id)
  assert.equal((await post(path, { ...draft, content: `  ${draft.content}  ` })).data.id, profileId)
  const tooLarge = await post(path, { ...draft, content: '实'.repeat(1400) })
  assert.equal(tooLarge.code, 'BOT_MEMORY_LIMIT')
  assert.equal((await get(`${path}?query=${encodeURIComponent('中文')}`)).data.items[0].id, profileId)
  assert.deepEqual((await get(path, adminUser)).data.items, [])
  assert.equal((await get(path, otherUser)).code, 'FORBIDDEN')

  const queued = await post(`${roomPath}/messages`, { clientRequestId: randomUUID(), text: '检查记忆并记录约定' })
  assert.equal(queued.code, 'OK', queued.message)
  const leaseOptions = { global: 4, perTeam: 4, ttlSeconds: 30 }
  const first = await claimBotRun(db, 'memory-test', leaseOptions)
  assert.ok(first)
  assert.equal(first.id, queued.data.runId)
  assert.equal((await loadBotRunContext(db, first))?.context.essentialMemories[0]?.id, profileId)
  const store = createPgMemoryStore(db, first, { id: first.id, owner: 'memory-test', epoch: first.lease_epoch })
  const notes = await store.add({ scope: 'bot', content: '每次发布前核对验收记录', essential: true })
  assert.equal((await store.search('验收', 10))[0]?.id, notes.id)
  await db.update(teamMember).set({ role: 'developer' }).where(eq(teamMember.user_id, viewerUser.userId))
  assert.equal((await post(`/bot-memories/${notes.id}/remove`, {}, viewerUser)).code, 'NOT_FOUND')
  await db.insert(botMemory).values(
    Array.from({ length: 99 }, (_, index) => ({
      team_id: first.team_id,
      bot_id: botId,
      scope: 'user',
      user_id: devUser.userId,
      content: `非驻留画像 ${index}`,
      normalized_content: `非驻留画像 ${index}`,
      source_user_id: devUser.userId,
      updated_by_kind: 'user',
    })),
  )
  assert.equal((await post(path, { ...draft, essential: false, content: '跨过条数上限' })).code, 'BOT_MEMORY_LIMIT')
  const publicNotes = await get(`${path}?scope=bot`, adminUser)
  assert.equal(publicNotes.data.items[0].sourceConversationId, null)
  assert.equal(
    (await get(`${path}?scope=bot`)).data.items.find(({ id }: { id: string }) => id === notes.id).canRemove,
    true,
  )
  assert.equal((await post(`/bot-memories/${profileId}/update`, { essential: false }, otherUser)).code, 'FORBIDDEN')

  const adminRoom = await post(`${teamPath}/bot-conversations`, { kind: 'direct', botId }, adminUser)
  const adminMessage = await post(
    `/bot-conversations/${adminRoom.data.id}/messages`,
    {
      clientRequestId: randomUUID(),
      text: '查看我自己的记忆',
    },
    adminUser,
  )
  assert.equal(adminMessage.code, 'OK', adminMessage.message)
  const second = await claimBotRun(db, 'memory-test', leaseOptions)
  assert.ok(second)
  assert.equal(second.id, adminMessage.data.runId)
  const context = await loadBotRunContext(db, second)
  assert.deepEqual(
    context?.context.essentialMemories.map(({ id }) => id),
    [notes.id],
  )
  assert.equal((await post(`/bot-memories/${notes.id}/remove`, {})).code, 'OK')
  assert.equal((await post(`/bot-memories/${profileId}/remove`, {})).code, 'OK')
  assert.deepEqual((await loadBotRunContext(db, first))?.context.essentialMemories, [])
})
