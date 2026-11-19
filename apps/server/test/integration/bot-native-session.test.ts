import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createFauxBotRunner } from '@dev-ops/devops-bot/testing'
import { and, eq } from 'drizzle-orm'
import { createHttpApp } from '../../src/bootstrap/create-http-app.ts'
import { claimBotRun, reconcileExpiredBotRuns } from '../../src/modules/bots/bots.run-queue.repository.ts'
import { botSession, botSessionEntry } from '../../src/modules/bots/bots.session.tables.ts'
import { botModelCatalog, botRun } from '../../src/modules/bots/bots.tables.ts'
import { executeClaimedBotRun, type BotRunner } from '../../src/modules/bots/runtime/execute-run.ts'
import { readBotMcpServers } from '../../src/modules/bots/runtime/mcp-configuration.ts'
import { createBotTestDatabase } from '../support/bot-database.ts'
import { seedBotWorkflowFixture } from '../support/bot-workflow-fixtures.ts'

test('私聊编辑、分支切换和分叉保留独立的房间日志与会话树', async (t) => {
  const { db, config: base, cleanup } = await createBotTestDatabase(t)
  const workspace = await mkdtemp(join(tmpdir(), 'devops-bot-native-fixture-'))
  cleanup.push(() => rm(workspace, { recursive: true, force: true }))
  const config = {
    ...base,
    BOT_WORKSPACE_DIR: workspace,
    GIT_CREDENTIAL_ENCRYPTION_KEY: Buffer.alloc(32, 68).toString('base64'),
  }
  const app = createHttpApp(config)
  cleanup.push(() => app.close())
  const fixture = await seedBotWorkflowFixture(app)
  const { botId, teamId, roomId, roomPath, post, get, adminUser } = fixture

  async function runOne(reply: string, check?: BotRunner) {
    const run = await claimBotRun(db, 'native-test', { global: 2, perTeam: 2, ttlSeconds: 30 })
    assert.ok(run)
    await executeClaimedBotRun(
      {
        config,
        db,
        cipher: null,
        onFailure: () => assert.fail('执行失败'),
        execute: check ?? createFauxBotRunner(reply),
      },
      run,
      new AbortController().signal,
    )
    const [status] = await db.select({ value: botRun.status }).from(botRun).where(eq(botRun.id, run.id))
    assert.equal(status?.value, 'succeeded')
  }

  await db.insert(botModelCatalog).values({
    provider_id: 'fixture',
    model_id: 'fixture-override',
    display_name: '夹具覆盖模型',
    auth_types: ['api_key'],
    context_window: 8192,
    reported_at: new Date(),
  })
  const settingPath = `${roomPath}/bots/${botId}/settings`
  assert.equal(
    (await post(settingPath, { modelId: 'not-in-catalog', thinkingLevel: 'high' })).code,
    'BOT_MODEL_OVERRIDE_INVALID',
  )
  assert.equal((await post(settingPath, { modelId: 'fixture-override', thinkingLevel: 'high' })).code, 'OK')
  const first = await post(`${roomPath}/messages`, { clientRequestId: randomUUID(), text: '原始消息' })
  assert.equal(first.code, 'OK')
  await runOne('原始回复', async (options) => {
    assert.equal(options.model.modelId, 'fixture-override')
    assert.equal(options.model.thinkingLevel, 'high')
    return createFauxBotRunner('原始回复')(options)
  })
  assert.equal((await get(roomPath)).data.botSettings[0].effectiveThinkingLevel, 'off')

  const editPath = `${roomPath}/messages/${first.data.message.id}/edit-resend`
  assert.equal(
    (await post(editPath, { clientRequestId: randomUUID(), text: '未授权编辑' }, adminUser)).code,
    'BOT_CONVERSATION_NOT_FOUND',
  )
  const edited = await post(editPath, { clientRequestId: randomUUID(), text: '编辑后的消息' })
  assert.equal(edited.code, 'OK', edited.message)
  await runOne('编辑分支回复')
  let messages = (await get(`${roomPath}/messages`)).data.items
  assert.equal(messages.length, 2)
  assert.equal(messages[0].body.blocks[0].text, '编辑后的消息')
  assert.deepEqual(messages[0].branchSiblings, { index: 2, total: 2 })
  assert.equal(
    (await post(`${roomPath}/branches/switch`, { messageId: edited.data.message.id, direction: 'previous' })).code,
    'OK',
  )
  messages = (await get(`${roomPath}/messages`)).data.items
  assert.equal(messages[1].body.blocks[0].text, '原始回复')
  assert.deepEqual(messages[0].branchSiblings, { index: 1, total: 2 })

  const forked = await post(`${roomPath}/fork`, { messageId: messages[1].id })
  assert.equal(forked.code, 'OK', forked.message)
  assert.deepEqual(forked.data.forkedFrom, { conversationId: roomId, messageId: messages[1].id })
  assert.equal(forked.data.botSettings[0].modelId, null)
  const copiedPath = `/bot-conversations/${forked.data.id}`
  const [, copyMessages] = await Promise.all([
    db
      .update(botModelCatalog)
      .set({ provider_id: 'other-fixture' })
      .where(eq(botModelCatalog.model_id, 'fixture-override')),
    get(`${copiedPath}/messages`),
  ])
  assert.equal(copyMessages.data.items[1].body.blocks[0].text, '原始回复')
  assert.notEqual(copyMessages.data.items[1].id, messages[1].id)
  assert.equal((await get(roomPath)).data.botSettings[0].isOverrideValid, false)
  const [sourceTree] = await db
    .select({ id: botSession.id })
    .from(botSession)
    .where(and(eq(botSession.team_id, teamId), eq(botSession.conversation_id, roomId)))
  assert.ok(sourceTree)
  const readSource = () =>
    db
      .select({ id: botSessionEntry.entry_id, content: botSessionEntry.content })
      .from(botSessionEntry)
      .where(eq(botSessionEntry.session_id, sourceTree.id))
      .orderBy(botSessionEntry.sequence)
  const before = await readSource()
  assert.equal(
    (await post(`${copiedPath}/messages`, { clientRequestId: randomUUID(), text: '只在分叉修改' })).code,
    'OK',
  )
  await runOne('分叉修改')
  assert.deepEqual(await readSource(), before)
  assert.deepEqual((await get(`${roomPath}/messages`)).data.items, messages)
})

test('提示模板写入展开内容和来源，MCP 配置由管理员授权且普通成员只见名称和状态', async (t) => {
  const { db, config, cleanup } = await createBotTestDatabase(t)
  const app = createHttpApp({ ...config, GIT_CREDENTIAL_ENCRYPTION_KEY: Buffer.alloc(32, 68).toString('base64') })
  cleanup.push(() => app.close())
  const { teamId, teamPath, roomPath, botId, post, get, adminUser, viewerUser } = await seedBotWorkflowFixture(app)
  const path = `${teamPath}/bot-prompt-templates`
  const input = { name: 'verify', description: '检查验收项', body: '请检查 $ARGUMENTS' }
  assert.equal((await post(path, input, viewerUser)).code, 'FORBIDDEN')
  const template = await post(path, input)
  assert.equal(template.code, 'OK', template.message)
  assert.equal((await post(path, input)).code, 'BOT_PROMPT_TEMPLATE_CONFLICT')
  const request = { text: '/verify 发布准备', promptTemplateId: template.data.id, clientRequestId: randomUUID() }
  const sent = await post(`${roomPath}/messages`, request)
  assert.equal(sent.code, 'OK', sent.message)
  assert.equal(sent.data.message.body.blocks[0].text, '请检查 发布准备')
  assert.equal(sent.data.message.body.references.promptTemplate.name, 'verify')
  assert.equal((await post(`/bot-prompt-templates/${template.data.id}/remove`, {})).code, 'OK')
  assert.equal((await post(`${roomPath}/messages`, request)).data.message.id, sent.data.message.id)
  const invoked = await claimBotRun(db, 'lost-native', { global: 1, perTeam: 1, ttlSeconds: 30 })
  assert.ok(invoked)
  await db
    .update(botRun)
    .set({ lease_until: new Date(0) })
    .where(eq(botRun.id, invoked.id))
  assert.equal(await reconcileExpiredBotRuns(db), 1)

  const mcpPath = `${teamPath}/bot-mcp-servers`
  const mcp = { name: 'remote', url: 'https://example.com/mcp', exposure: 'deferred', botIds: [botId] }
  assert.equal((await post(mcpPath, mcp)).code, 'FORBIDDEN')
  assert.equal((await post(mcpPath, { ...mcp, url: 'https://127.0.0.1/' }, adminUser)).code, 'BOT_MCP_SERVER_INVALID')
  const server = await post(mcpPath, mcp, adminUser)
  assert.equal(server.code, 'OK', server.message)
  assert.deepEqual((await get(mcpPath, viewerUser)).data.items, [{ name: 'remote', status: 'enabled' }])
  assert.equal((await readBotMcpServers(db, null, teamId, botId)).length, 1)
  assert.deepEqual(await readBotMcpServers(db, null, teamId, randomUUID()), [])
  assert.equal((await post(`/bot-mcp-servers/${server.data.id}/disable`, {}, adminUser)).code, 'OK')
  assert.deepEqual(await readBotMcpServers(db, null, teamId, botId), [])
})
