import assert from 'node:assert/strict'
import { test } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { listModelCatalog, runBotSession } from '@dev-ops/devops-bot'
import { and, eq } from 'drizzle-orm'
import { createBotWorker } from '../../src/bootstrap/create-bot-worker.ts'
import { createHttpApp } from '../../src/bootstrap/create-http-app.ts'
import { publishBotModelCatalog } from '../../src/modules/bots/bots.catalog.ts'
import { createBotConnectionsService } from '../../src/modules/bots/bots.connections.service.ts'
import { enqueueBotRun } from '../../src/modules/bots/bots.run-queue.repository.ts'
import { createBotsService } from '../../src/modules/bots/bots.service.ts'
import { botRun } from '../../src/modules/bots/bots.tables.ts'
import {
  botConversation,
  botConversationMember,
  botMessage,
} from '../../src/modules/collaboration/bot-conversations.tables.ts'
import { createSecretCipher } from '../../src/modules/configuration/configuration.crypto.ts'
import { createBotTestDatabase } from '../support/bot-database.ts'
import { seedKnowledgeFixture } from '../support/knowledge-fixtures.ts'

test(
  'DeepSeek 真实连接：加密保存、绑定模型并由执行进程完成对话',
  {
    timeout: 45_000,
    skip: process.env.DEVOPS_BOT_LIVE_TEST !== '1',
  },
  async (t) => {
    const apiKey = process.env.DEEPSEEK_API_KEY
    assert.ok(apiKey, 'apps/server/.env 必须提供 DEEPSEEK_API_KEY')
    const { db, config, cleanup } = await createBotTestDatabase(t)
    const encryptionKey = Buffer.alloc(32, 17).toString('base64')
    const app = createHttpApp(config)
    cleanup.push(() => app.close())
    const { teamId, adminUser } = await seedKnowledgeFixture(app)
    const actor = { id: adminUser.userId, name: '真实验证管理员', email: 'fixture@live.example.test' }
    const catalog = listModelCatalog().filter((model) => model.providerId === 'deepseek')
    await publishBotModelCatalog(db, catalog)
    const connections = createBotConnectionsService(db, createSecretCipher(encryptionKey))
    const connection = await connections.create(actor, teamId, { name: '真实验证', providerId: 'deepseek', apiKey })
    const bots = createBotsService(db)
    const item = await bots.create(actor, teamId, {
      name: '真实验证 Bot',
      responsibility: '回复验证文本',
      ownerUserId: actor.id,
    })
    await bots.bind(actor, item.id, {
      connectionId: connection.id,
      modelId: 'deepseek-flash',
      configVersion: item.configVersion,
    })
    const [conversation] = await db
      .insert(botConversation)
      .values({
        team_id: teamId,
        name: '真实验证会话',
        kind: 'direct',
        created_by: actor.id,
      })
      .returning()
    assert.ok(conversation)
    await db.insert(botConversationMember).values([
      {
        team_id: teamId,
        conversation_id: conversation.id,
        member_id: actor.id,
        member_kind: 'user',
        added_by: actor.id,
      },
      { team_id: teamId, conversation_id: conversation.id, member_id: item.id, member_kind: 'bot', added_by: actor.id },
    ])
    const [message] = await db
      .insert(botMessage)
      .values({
        team_id: teamId,
        conversation_id: conversation.id,
        sequence: 1n,
        speaker_kind: 'user',
        speaker_id: actor.id,
        body: { blocks: [{ type: 'text', text: '只回复：连接验证通过' }] },
      })
      .returning()
    assert.ok(message)
    const run = await db.transaction((tx) =>
      enqueueBotRun(tx, {
        team_id: teamId,
        bot_id: item.id,
        conversation_id: conversation.id,
        trigger_user_id: actor.id,
        trigger_message_id: message.id,
        input_version: 0,
      }),
    )
    const worker = createBotWorker(
      { ...config, GIT_CREDENTIAL_ENCRYPTION_KEY: encryptionKey, BOT_RUN_TIMEOUT_SECONDS: 25 },
      runBotSession,
      () => {},
    )
    cleanup.push(worker.close)
    await worker.pollOnce()
    for (let attempt = 0; attempt < 55; attempt++) {
      const [state] = await db.select().from(botRun).where(eq(botRun.id, run.id))
      if (state?.status === 'queued' || state?.status === 'running') {
        await delay(500)
        continue
      }
      assert.equal(state?.status, 'succeeded', state?.failure_kind ?? '运行不存在')
      const [reply] = await db
        .select({ body: botMessage.body })
        .from(botMessage)
        .where(and(eq(botMessage.conversation_id, conversation.id), eq(botMessage.run_id, run.id)))
      assert.ok(JSON.stringify(reply?.body).includes('连接验证通过'))
      t.diagnostic(JSON.stringify({ turns: state.turns, usage: state.usage }))
      return
    }
    assert.fail('等待真实模型运行超时')
  },
)
