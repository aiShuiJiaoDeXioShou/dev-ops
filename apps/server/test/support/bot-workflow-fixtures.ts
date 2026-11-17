import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { publishBotModelCatalog } from '../../src/modules/bots/bots.catalog.ts'
import { seedKnowledgeFixture, type KnowledgeFixtureUser } from './knowledge-fixtures.ts'

/**
 * 创建拥有加密模型连接和可领取运行的私聊，供任务流程测试复用。
 * @param app 使用测试库和测试加密配置的 HTTP 应用。
 * @returns 团队、私聊、可运行 Bot 与请求辅助函数。
 */
export async function seedBotWorkflowFixture(app: FastifyInstance) {
  const fixture = await seedKnowledgeFixture(app)
  const { adminUser, devUser, teamId } = fixture
  async function get(path: string, user: KnowledgeFixtureUser = devUser) {
    const response = await app.inject({ url: `/api/v1${path}`, headers: { cookie: user.cookie } })
    assert.equal(response.statusCode, 200)
    return response.json()
  }
  async function post(path: string, body: object, user: KnowledgeFixtureUser = devUser) {
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1${path}`,
      payload: body,
      headers: { cookie: user.cookie, 'idempotency-key': randomUUID() },
    })
    assert.equal(response.statusCode, 200)
    return response.json()
  }

  await publishBotModelCatalog(app.db, [
    {
      providerId: 'fixture',
      modelId: 'fixture-chat',
      displayName: '测试对话模型',
      authTypes: ['api_key'],
      contextWindow: 8192,
    },
  ])
  const teamPath = `/teams/${teamId}`
  const connection = await post(
    `${teamPath}/bot-model-connections`,
    {
      name: '测试凭据连接',
      providerId: 'fixture',
      apiKey: 'fixture-only',
    },
    adminUser,
  )
  assert.equal(connection.code, 'OK', connection.message)
  const created = await post(`${teamPath}/bots`, {
    name: '任务助理',
    responsibility: '执行任务',
    ownerUserId: devUser.userId,
  })
  assert.equal(created.code, 'OK', created.message)
  const botId = String(created.data.id)
  const bound = await post(
    `/bots/${botId}/bind-model`,
    {
      configVersion: created.data.configVersion,
      connectionId: connection.data.id,
      modelId: 'fixture-chat',
    },
    adminUser,
  )
  assert.equal(bound.code, 'OK', bound.message)
  const room = await post(`${teamPath}/bot-conversations`, { botId, kind: 'direct' })
  assert.equal(room.code, 'OK', room.message)
  const roomId = String(room.data.id)
  return { ...fixture, teamPath, botId, roomId, roomPath: `/bot-conversations/${roomId}`, get, post }
}
