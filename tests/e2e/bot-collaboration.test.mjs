import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { createBotWorker } from '../../apps/server/dist/bootstrap/create-bot-worker.js'
import { listModelCatalog, runBot } from '../../packages/devops-bot/dist/index.js'
import { createFauxBotRunner } from '../../packages/devops-bot/dist/testing.js'
import { createLocalHttpFixture } from './support/local-http.mjs'

async function waitFor(read, accept, ms = 30_000) {
  const deadline = Date.now() + ms
  let latest
  while (Date.now() < deadline) {
    latest = await read()
    if (accept(latest)) return latest
    await delay(200)
  }
  assert.fail(`业务状态未在期限内更新：${latest?.status ?? latest?.code ?? '未知'}`)
}

function checked(response) {
  assert.equal(response.status, 200)
  assert.equal(response.body.success, true, response.body.message)
  return response.body.data
}

async function verifyBotCollaboration(t, live) {
  const fixture = await createLocalHttpFixture(t)
  if (!fixture) return
  const { cleanup, config, env, request, post, teamId, user } = fixture
  assert.ok(user?.id, 'HTTP 会话应返回团队管理员')
  const configuredKey = process.env.DEEPSEEK_API_KEY ?? env.DEEPSEEK_API_KEY
  if (live && !configuredKey) {
    t.skip('本地 Server .env 未配置 DeepSeek 凭据')
    return
  }
  const projectsPath = `/api/v1/teams/${teamId}/projects`
  const fixtureProject = checked(await post(projectsPath, { name: 'Bot 验收项目' }))
  const catalog = live
    ? listModelCatalog().filter(({ providerId }) => providerId === 'deepseek')
    : [
        {
          providerId: 'fixture',
          modelId: 'test-chat',
          displayName: '测试模型',
          authTypes: ['api_key'],
          contextWindow: 8192,
        },
      ]
  const reply = createFauxBotRunner('执行完成')
  const runner = live
    ? runBot
    : async (options) => {
        if (options.tools.some(({ name }) => name === 'submit_task_result')) {
          const read = options.tools.find(({ name }) => name === 'platform_api_call')
          const submit = options.tools.find(({ name }) => name === 'submit_task_result')
          assert.ok(read && submit)
          const data = await read.execute({ method: 'GET', path: projectsPath }, options.signal)
          assert.equal(data.isError, false, data.text)
          assert.match(data.text, /Bot 验收项目/u)
          const result = await submit.execute(
            {
              body: '已从项目列表核对 Bot 验收项目。',
              completionNote: '项目已存在',
              evidence: [`核对项目 ${fixtureProject.id}`],
              tags: ['交付核验'],
            },
            options.signal,
          )
          assert.equal(result.isError, undefined, result.text)
        }
        return reply(options)
      }
  const logs = []
  const worker = createBotWorker(config, runner, (level, message, context) => logs.push({ level, message, context }), {
    catalog,
  })
  cleanup.push(() => worker.close())
  await worker.start()
  const team = `/api/v1/teams/${teamId}`
  const connection = checked(
    await post(`${team}/bot-model-connections`, {
      name: '验收模型连接',
      providerId: live ? 'deepseek' : 'fixture',
      apiKey: live ? configuredKey : 'fixture-only',
    }),
  )
  const bot = checked(
    await post(`${team}/bots`, {
      name: '协作验收助理',
      ownerUserId: user.id,
      responsibility: '按成员明确要求核对团队项目与交付',
      modelBinding: { connectionId: connection.id, modelId: live ? 'deepseek-flash' : 'test-chat' },
    }),
  )
  assert.equal(bot.modelConnectionId, connection.id)
  const room = checked(await post(`${team}/bot-conversations`, { kind: 'direct', botId: bot.id }))
  const roomPath = `/api/v1/bot-conversations/${room.id}`
  const sendStarted = performance.now()
  const sent = checked(
    await post(`${roomPath}/messages`, {
      text: '请直接回复“就绪”。',
      clientRequestId: randomUUID(),
    }),
  )
  const events = checked(await request(`${roomPath}/events`))
  const feedback = events.items.find(
    ({ runId, kind, payload }) =>
      runId === sent.runId && kind === 'run_status' && ['queued', 'running'].includes(payload.status),
  )
  assert.ok(feedback, '发出消息后应能读取排队或执行反馈')
  assert.ok(performance.now() - sendStarted < 3_000, '排队反馈必须在 3 秒内可见')
  assert.equal(checked(await request(`${roomPath}/tasks`)).items.length, 0)
  await waitFor(
    async () => checked(await request(`${roomPath}/messages`)),
    ({ items }) => items.some((message) => message.speakerKind === 'bot' && message.runId === sent.runId),
    live ? 60_000 : 15_000,
  )
  const created = checked(
    await post(`${roomPath}/tasks`, {
      title: '核对验收项目',
      businessOwnerId: user.id,
      acceptanceCriteria: `调用 platform_api_call 用 GET 读取 ${projectsPath}。确认结果含“Bot 验收项目”，再调用 submit_task_result 提交中文结果、完成说明和证据，证据写入找到的项目 ID。最后简短回复完成。`,
    }),
  )
  assert.equal(created.runStatus, 'queued')
  const taskPath = `/api/v1/bot-tasks/${created.task.id}`
  const awaiting = await waitFor(
    async () => checked(await request(taskPath)),
    ({ status }) => status === 'awaiting_review' || status === 'waiting',
    live ? 75_000 : 20_000,
  )
  assert.equal(
    awaiting.status,
    'awaiting_review',
    JSON.stringify(awaiting.runs.map(({ failureKind, status }) => ({ failureKind, status }))),
  )
  assert.ok(awaiting.trace.some(({ kind, state }) => kind === 'platform_api' && state === 'succeeded'))
  assert.equal(awaiting.results[0].submittedByBotId, bot.id)
  assert.equal(checked(await request(`${team}/bot-inbox`)).items[0].id, created.task.id)
  const accepted = checked(await post(`${taskPath}/accept`, { resultId: awaiting.results[0].id, comment: '验收通过' }))
  assert.equal(accepted.task.status, 'completed')
  assert.equal(accepted.review.reviewerUserId, user.id)
  assert.equal(checked(await request(`${team}/bot-inbox`)).count, 0)
  const apiLog = logs
    .map(({ context }) => context)
    .find((context) => context?.runId === created.runId && context?.kind === 'platform_api')
  assert.equal(apiLog?.teamId, teamId)
  assert.equal(apiLog?.conversationId, room.id)
  assert.equal(apiLog?.botId, bot.id)
  assert.ok(apiLog?.callId)
  const serialized = JSON.stringify(logs)
  assert.ok(!serialized.includes('Bot 验收项目'))
  if (live) assert.ok(!serialized.includes(configuredKey))
}

test('真实 HTTP 与 PostgreSQL：Bot 领取运行、读取平台数据、送验与人工验收', { timeout: 120_000 }, async (t) => {
  await verifyBotCollaboration(t, false)
})

test(
  'DeepSeek 实测：同一执行服务用 API Key 完成 Bot 任务闭环',
  {
    timeout: 150_000,
    skip: process.env.DEVOPS_BOT_LIVE_TEST !== '1' && '按需开启真实模型验证',
  },
  async (t) => {
    await verifyBotCollaboration(t, true)
  },
)
