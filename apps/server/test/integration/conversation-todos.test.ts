import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { createHttpApp } from '../../src/bootstrap/create-http-app.ts'
import { claimBotRun, isConversationBotRun } from '../../src/modules/bots/bots.run-queue.repository.ts'
import { createTodoTool } from '../../src/modules/bots/runtime/todo-tools.ts'
import { createBotTestDatabase } from '../support/bot-database.ts'
import { seedBotWorkflowFixture } from '../support/bot-workflow-fixtures.ts'

test('待办保存到会话，停止后的旧租约不能覆盖清单', async (t) => {
  const { db, config, cleanup } = await createBotTestDatabase(t)
  const app = createHttpApp({ ...config, GIT_CREDENTIAL_ENCRYPTION_KEY: Buffer.alloc(32, 28).toString('base64') })
  cleanup.push(() => app.close())
  const { roomPath, get, post } = await seedBotWorkflowFixture(app)
  const sent = await post(`${roomPath}/messages`, { clientRequestId: randomUUID(), text: '检查服务' })
  assert.equal(sent.code, 'OK', sent.message)
  const run = await claimBotRun(db, 'todo-test', { global: 3, perTeam: 2, ttlSeconds: 60 })
  assert.ok(run && isConversationBotRun(run))
  const tool = createTodoTool(db, run, { id: run.id, owner: 'todo-test', epoch: run.lease_epoch })
  const signal = new AbortController().signal
  const items = [{ text: '读取服务状态', status: 'in_progress' }]
  assert.equal((await tool.execute({ items }, signal)).isError, undefined)
  assert.deepEqual((await get(roomPath)).data.todos, items)
  assert.equal((await tool.execute({ items: [{ text: '', status: 'completed' }] }, signal)).isError, true)
  assert.equal((await post(`/bot-runs/${run.id}/stop`, {})).code, 'OK')
  assert.equal((await tool.execute({ items: [] }, signal)).isError, true)
  assert.deepEqual((await get(roomPath)).data.todos, items)
})
