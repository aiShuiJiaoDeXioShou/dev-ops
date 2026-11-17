import assert from 'node:assert/strict'
import { test } from 'node:test'
import { and, eq } from 'drizzle-orm'
import { createHttpApp } from '../../src/bootstrap/create-http-app.ts'
import { claimBotRun } from '../../src/modules/bots/bots.run-queue.repository.ts'
import { createTaskResultTool } from '../../src/modules/bots/runtime/task-tools.ts'
import { workTagLink } from '../../src/modules/collaboration/bot-conversations.tables.ts'
import { createBotTestDatabase } from '../support/bot-database.ts'
import { seedBotWorkflowFixture } from '../support/bot-workflow-fixtures.ts'

test('工作标签按团队和会话权限关联，提交成功时统一整理且可安全删除', async (t) => {
  const { db, config, cleanup } = await createBotTestDatabase(t)
  const app = createHttpApp({ ...config, GIT_CREDENTIAL_ENCRYPTION_KEY: Buffer.alloc(32, 72).toString('base64') })
  cleanup.push(() => app.close())
  const { adminUser, devUser, viewerUser, otherUser, botId, teamPath, roomPath, roomId, post, get } =
    await seedBotWorkflowFixture(app)
  const tagListPath = `${teamPath}/work-tags`
  assert.equal((await post(tagListPath, { name: '应拒绝' }, viewerUser)).code, 'FORBIDDEN')
  assert.equal((await get(tagListPath, otherUser)).code, 'FORBIDDEN')
  const created = await post(tagListPath, { name: 'QA' })
  const duplicate = await post(tagListPath, { name: ' ｑａ ' })
  assert.equal(created.code, 'OK', created.message)
  assert.equal(duplicate.data.id, created.data.id)
  const tagId = String(created.data.id)
  const tagPath = `/work-tags/${tagId}`
  const relation = { targetKind: 'conversation', targetId: roomId }
  assert.equal((await post(`${tagPath}/link`, relation, adminUser)).code, 'BOT_CONVERSATION_NOT_FOUND')
  assert.equal((await post(`${tagPath}/link`, relation)).code, 'OK')
  const rooms = `${teamPath}/bot-conversations?tagId=${tagId}`
  assert.equal((await get(rooms)).data.items.length, 1)
  assert.equal((await get(rooms, adminUser)).data.items.length, 0)
  assert.equal((await post(`${tagPath}/update`, { name: '质量' })).data.name, '质量')
  assert.equal((await get(roomPath)).data.tags[0].name, '质量')

  const task = await post(`${roomPath}/tasks`, {
    title: '核对验收',
    acceptanceCriteria: '保留验收记录',
    businessOwnerId: devUser.userId,
  })
  assert.equal(task.code, 'OK', task.message)
  const run = await claimBotRun(db, 'tags-test', { global: 2, perTeam: 1, ttlSeconds: 30 })
  assert.ok(run)
  const taskPath = `/bot-tasks/${task.data.task.id}`
  const tool = createTaskResultTool(db, { id: run.id, owner: 'tags-test', epoch: run.lease_epoch })
  const signal = new AbortController().signal
  const result = { body: '已完成交付核验', completionNote: '复核完成', evidence: [] }
  assert.equal((await tool.execute({ ...result, body: ' ', tags: ['失败标签'] }, signal)).isError, true)
  assert.equal((await get(taskPath)).data.tags.length, 0)
  assert.equal((await tool.execute({ ...result, tags: ['质量', '新分类', ' 新分类 '] }, signal)).isError, undefined)
  assert.equal((await tool.execute({ ...result, tags: ['不得再次整理'] }, signal)).isError, undefined)
  const tagged = (await get(taskPath)).data
  assert.equal(tagged.status, 'awaiting_review')
  assert.deepEqual(tagged.tags.map((tag: { name: string }) => tag.name).sort(), ['新分类', '质量'].sort())
  assert.equal((await get(tagListPath)).data.items.length, 2)
  const [link] = await db
    .select()
    .from(workTagLink)
    .where(and(eq(workTagLink.tag_id, tagId), eq(workTagLink.target_kind, 'task')))
  assert.equal(link?.linked_by_kind, 'bot')
  assert.equal(link.linked_by_id, botId)
  assert.equal((await post(`${taskPath}/accept`, { resultId: tagged.results[0].id })).code, 'OK')
  assert.equal((await post(`${tagPath}/remove`, {})).code, 'OK')
  assert.equal((await get(rooms)).data.items.length, 0)
  assert.equal((await get(roomPath)).data.tags.length, 0)
  assert.equal((await get(taskPath)).data.status, 'completed')
  assert.deepEqual(
    (await get(taskPath)).data.tags.map((tag: { name: string }) => tag.name),
    ['新分类'],
  )
})
