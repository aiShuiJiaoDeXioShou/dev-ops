import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { createHttpApp } from '../../src/bootstrap/create-http-app.ts'
import { isConversationBotRun, claimBotRun } from '../../src/modules/bots/bots.run-queue.repository.ts'
import { loadBotRunContext } from '../../src/modules/bots/runtime/context.ts'
import { createSkillViewTool } from '../../src/modules/bots/runtime/skill-tool.ts'
import { createBotTestDatabase } from '../support/bot-database.ts'
import { seedBotWorkflowFixture } from '../support/bot-workflow-fixtures.ts'

test('技能候选校验可用性与团队，已领取运行继续读取它固定的旧版本', async (t) => {
  const { db, config, cleanup } = await createBotTestDatabase(t)
  const app = createHttpApp({ ...config, GIT_CREDENTIAL_ENCRYPTION_KEY: Buffer.alloc(32, 82).toString('base64') })
  cleanup.push(() => app.close())
  const { botId, roomPath, devUser, otherTeamId, otherUser, teamPath, post, get } = await seedBotWorkflowFixture(app)
  const skillFields = {
    name: '交付复核',
    identifier: 'delivery-review',
    category: 'delivery',
    contentVersion: '1.0.0',
    summary: '核对交付证据',
    content: '初版指令：核对工单状态',
  }
  const local = await post(`${teamPath}/skills`, skillFields)
  assert.equal(local.code, 'OK', local.message)
  const foreign = await post(`/teams/${otherTeamId}/skills`, skillFields, otherUser)
  assert.equal(foreign.code, 'OK', foreign.message)
  const botPath = `/bots/${botId}`
  const existing = await get(botPath)
  const configInput = {
    configVersion: existing.data.configVersion,
    name: existing.data.name,
    responsibility: existing.data.responsibility,
    ownerUserId: devUser.userId,
  }
  assert.equal(
    (await post(`${botPath}/update`, { ...configInput, skillIds: [foreign.data.id] })).code,
    'VALIDATION_ERROR',
  )
  const configured = await post(`${botPath}/update`, { ...configInput, skillIds: [local.data.id] })
  assert.equal(configured.code, 'OK', configured.message)
  const candidate = (await get(roomPath)).data.skillReferences[0]
  assert.equal(candidate.id, local.data.id)
  assert.deepEqual(candidate.botIds, [botId])

  const messagePath = `${roomPath}/messages`
  const message = await post(messagePath, {
    text: '@delivery-review 复核',
    clientRequestId: randomUUID(),
    skillIds: [local.data.id],
  })
  assert.equal(message.code, 'OK', message.message)
  const run = await claimBotRun(db, 'skill-test', { global: 2, perTeam: 2, ttlSeconds: 60 })
  assert.ok(run && isConversationBotRun(run))
  assert.equal(run.id, message.data.runId)
  const lease = { id: run.id, owner: 'skill-test', epoch: run.lease_epoch }
  const skillPath = `/skills/${local.data.id}`
  const edited = await post(`${skillPath}/update`, {
    version: local.data.version,
    name: skillFields.name,
    category: skillFields.category,
    contentVersion: '1.1.0',
    summary: skillFields.summary,
    content: '新版指令：补充发布证据',
  })
  assert.equal(edited.code, 'OK', edited.message)
  const disabled = await post(`${skillPath}/disable`, { version: edited.data.version })
  assert.equal(disabled.code, 'OK', disabled.message)
  assert.deepEqual((await get(roomPath)).data.skillReferences, [])
  assert.equal(
    (await post(messagePath, { text: '禁止新调用', clientRequestId: randomUUID(), skillIds: [local.data.id] })).code,
    'PRECONDITION_FAILED',
  )
  assert.equal(
    (
      await post(`${botPath}/update`, {
        ...configInput,
        configVersion: configured.data.configVersion,
        skillIds: [local.data.id],
      })
    ).code,
    'VALIDATION_ERROR',
  )

  const context = await loadBotRunContext(db, run, 50)
  assert.ok(context)
  assert.equal(context.hasUnavailableSkillReference, false)
  assert.match(context.context.layers.find(({ title }) => title === '已配置技能')?.body ?? '', /delivery-review/u)
  const tool = createSkillViewTool(db, run, lease, context.skillVersions)
  const output = await tool.execute({ identifier: skillFields.identifier }, new AbortController().signal)
  assert.equal(output.text, skillFields.content)
  assert.equal((await get(`${botPath}/runs`)).data.items[0].skillVersions[0].version, '1.0.0')
})
