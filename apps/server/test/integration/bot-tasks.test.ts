import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { createHttpApp } from '../../src/bootstrap/create-http-app.ts'
import { botTask } from '../../src/modules/tasks/bot-tasks.tables.ts'
import { createBotTestDatabase } from '../support/bot-database.ts'
import { seedBotWorkflowFixture } from '../support/bot-workflow-fixtures.ts'

test('旧任务保留只读查询和成员隔离，所有任务写路由已删除', async (t) => {
  const { db, config, cleanup } = await createBotTestDatabase(t)
  const app = createHttpApp({
    ...config,
    DOCS_ENABLED: true,
    GIT_CREDENTIAL_ENCRYPTION_KEY: Buffer.alloc(32, 28).toString('base64'),
  })
  cleanup.push(() => app.close())
  const { devUser, otherUser, teamId, botId, roomId, roomPath, get } = await seedBotWorkflowFixture(app)
  const id = randomUUID()
  await db.insert(botTask).values({
    id,
    team_id: teamId,
    conversation_id: roomId,
    title: '历史工作',
    acceptance_criteria: '保留记录',
    business_owner_id: devUser.userId,
    executor_bot_id: botId,
    status: 'completed',
    created_by: devUser.userId,
  })
  assert.equal((await get(`${roomPath}/tasks`)).data.items[0].id, id)
  assert.equal((await get(`/bot-tasks/${id}`)).data.title, '历史工作')
  assert.equal((await get(`/bot-tasks/${id}`, otherUser)).code, 'BOT_CONVERSATION_NOT_FOUND')
  const paths = app.swagger().paths ?? {}
  assert.equal(paths['/api/v1/bot-conversations/{conversationId}/tasks']?.post, undefined)
  for (const action of ['append', 'handoff', 'rerun', 'cancel', 'accept', 'request-changes']) {
    assert.equal(paths[`/api/v1/bot-tasks/{taskId}/${action}`], undefined)
    const result = await app.inject({
      method: 'POST',
      url: `/api/v1/bot-tasks/${id}/${action}`,
      payload: {},
      headers: { cookie: devUser.cookie },
    })
    assert.equal(result.json().success, false)
  }
  assert.equal((await get(`/bot-tasks/${id}`)).data.status, 'completed')
})
