import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createHttpApp } from '../../src/bootstrap/create-http-app.ts'
import { createBotTestDatabase } from '../support/bot-database.ts'
import { seedBotWorkflowFixture } from '../support/bot-workflow-fixtures.ts'

test('工作标签按团队和会话权限关联，分类可安全删除', async (t) => {
  const { config, cleanup } = await createBotTestDatabase(t)
  const app = createHttpApp({ ...config, GIT_CREDENTIAL_ENCRYPTION_KEY: Buffer.alloc(32, 72).toString('base64') })
  cleanup.push(() => app.close())
  const { adminUser, viewerUser, otherUser, teamPath, roomPath, roomId, post, get } = await seedBotWorkflowFixture(app)
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

  assert.equal((await post(`${tagPath}/remove`, {})).code, 'OK')
  assert.equal((await get(rooms)).data.items.length, 0)
  assert.equal((await get(roomPath)).data.tags.length, 0)
})
