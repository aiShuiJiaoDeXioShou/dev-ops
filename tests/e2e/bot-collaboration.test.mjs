import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { createBotWorker } from '../../apps/server/dist/bootstrap/create-bot-worker.js'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { botRunToken } from '../../apps/server/dist/modules/bots/bots.tables.js'
import { botTask } from '../../apps/server/dist/modules/tasks/bot-tasks.tables.js'
import { createFauxBotRunner } from '../../packages/devops-bot/dist/testing.js'
import { createLocalHttpFixture } from './support/local-http.mjs'
import { runDevops } from './support/devops-cli.mjs'

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

test('真实 HTTP 与 PostgreSQL：会话长任务、运行令牌 CLI、待办持久化与历史只读', { timeout: 120_000 }, async (t) => {
  const fixture = await createLocalHttpFixture(t)
  if (!fixture) return
  const { app, address, cleanup, config, request, post, teamId, user } = fixture
  assert.ok(user?.id, 'HTTP 会话应返回团队管理员')
  const workspace = await mkdtemp(join(tmpdir(), 'devops-bot-http-'))
  cleanup.push(() => rm(workspace, { recursive: true, force: true }))
  const team = `/api/v1/teams/${teamId}`
  const fixtureProject = checked(await post(`${team}/projects`, { name: 'Bot 验收项目' }))
  const catalog = [
    {
      providerId: 'fixture',
      modelId: 'test-chat',
      displayName: '测试模型',
      authTypes: ['api_key'],
      contextWindow: 8192,
    },
  ]
  const todos = [{ text: '核对验收项目', status: 'in_progress' }]
  const completedTodos = [{ text: '核对验收项目', status: 'completed' }]
  const cliEntry = fileURLToPath(new URL('../../apps/cli/dist/index.js', import.meta.url))
  const logs = []
  const runnerErrors = []
  let executions = 0
  let releaseFirstRun
  const firstRunCanFinish = new Promise((resolve) => {
    releaseFirstRun = resolve
  })
  const runner = async (options) => {
    try {
      executions += 1
      for (const name of ['platform_api_call', 'get_current_context', 'submit_task_result']) {
        assert.equal(
          options.tools.some((tool) => tool.name === name),
          false,
          `已移除工具 ${name} 不应出现`,
        )
      }
      const update = options.tools.find(({ name }) => name === 'update_todos')
      const bash = options.tools.find(({ name }) => name === 'bash')
      assert.ok(update)
      assert.ok(bash)
      if (executions === 1) {
        const started = await update.execute({ items: todos }, options.signal)
        assert.ok(!started.isError, started.text)
        await firstRunCanFinish
        // 测试自行安装命令入口，不依赖工作树中手工创建的 dist/devops 软链。
        const bin = join(options.workspace.directory, 'bin')
        await mkdir(bin)
        await writeFile(join(bin, 'devops'), `#!/bin/sh\nexec node '${cliEntry.replaceAll("'", "'\\''")}' "$@"\n`, {
          mode: 0o700,
        })
        const projects = await bash.execute(
          { command: `PATH="$PWD/bin:$PATH" devops project list --team ${teamId} --json` },
          options.signal,
        )
        assert.equal(projects.isError, false, projects.text)
        const result = JSON.parse(projects.text)
        assert.equal(result.success, true)
        assert.equal(result.data.total, 1)
        assert.equal(result.data.items[0].id, fixtureProject.id)
        const waiting = await update.execute({ items: completedTodos, needsReply: true }, options.signal)
        assert.ok(!waiting.isError, waiting.text)
        return createFauxBotRunner('已核对验收项目。是否继续完成本次工作？')(options)
      }
      const finished = await update.execute({ items: completedTodos, needsReply: false }, options.signal)
      assert.ok(!finished.isError, finished.text)
      return createFauxBotRunner('工作已完成。')(options)
    } catch (error) {
      runnerErrors.push(error)
      throw error
    }
  }
  const worker = createBotWorker(
    { ...config, APP_ORIGIN: address, BOT_WORKSPACE_DIR: workspace },
    runner,
    (level, message, context) => logs.push({ level, message, context }),
    { catalog },
  )
  cleanup.push(() => worker.close())
  cleanup.push(() => releaseFirstRun())
  await worker.start()
  const connection = checked(
    await post(`${team}/bot-model-connections`, {
      name: '验收模型连接',
      providerId: 'fixture',
      apiKey: 'fixture-only',
    }),
  )
  const bot = checked(
    await post(`${team}/bots`, {
      name: '小林',
      ownerUserId: user.id,
      responsibility: '按成员明确要求核对团队项目与交付',
      modelBinding: { connectionId: connection.id, modelId: 'test-chat' },
    }),
  )
  // Linux 尚无平台网络白名单沙盒；Mac 使用默认沙盒验证 CLI 网关。
  if (process.platform !== 'darwin') {
    checked(await post(`/api/v1/bots/${bot.id}/set-access`, { configVersion: bot.configVersion, accessMode: 'full' }))
  }
  const room = checked(await post(`${team}/bot-conversations`, { kind: 'direct', botId: bot.id }))
  const roomPath = `/api/v1/bot-conversations/${room.id}`
  const { token } = checked(await post('/api/v1/me/tokens', { name: '协作 CLI 验收' }))
  const cli = { server: address, team: teamId, token }
  const readRoomStatus = async () => {
    if (runnerErrors.length > 0) throw runnerErrors[0]
    return checked(await request(`${team}/bot-conversations`)).items.find(({ id }) => id === room.id)
  }
  assert.equal((await readRoomStatus()).workStatus, null)
  const sendStarted = performance.now()
  const sent = await runDevops(cli, ['conversation', 'send', room.id, '--file', '-'], {
    text: '核对验收项目，列出步骤，完成后询问我是否继续。',
    clientRequestId: randomUUID(),
  })
  const events = checked(await request(`${roomPath}/events`))
  assert.ok(
    events.items.some(
      ({ runId, kind, payload }) =>
        runId === sent.runId && kind === 'run_status' && ['queued', 'running'].includes(payload.status),
    ),
    '发出消息后应能读取排队或执行反馈',
  )
  assert.ok(performance.now() - sendStarted < 3_000, '排队反馈必须在 3 秒内可见')
  const active = await waitFor(
    async () => {
      if (runnerErrors.length > 0) throw runnerErrors[0]
      return checked(await request(roomPath))
    },
    ({ todos }) => todos.length === 1,
  )
  assert.deepEqual(active.todos, todos)
  assert.equal((await readRoomStatus()).workStatus, 'running')
  releaseFirstRun()
  await waitFor(readRoomStatus, ({ workStatus }) => workStatus === 'awaiting_reply')
  assert.deepEqual(checked(await request(roomPath)).todos, completedTodos)
  const inbox = await runDevops(cli, ['task', 'inbox'])
  assert.equal(inbox.count, 1)
  assert.equal(inbox.items[0].conversationId, room.id)
  assert.equal(inbox.items[0].reason, 'awaiting_reply')
  assert.equal((await runDevops(cli, ['task', 'list', room.id])).items.length, 0)
  const history = checked(await request(`${roomPath}/messages`))
  assert.match(
    history.items.find(({ speakerKind, runId }) => speakerKind === 'bot' && runId === sent.runId)?.body.blocks[0].text,
    /是否继续/u,
  )
  const audit = checked(await request(`${roomPath}/events`)).items.find(
    ({ runId, kind, payload }) => runId === sent.runId && kind === 'tool_activity' && payload.name === 'devops',
  )
  assert.equal(audit?.payload.state, 'succeeded')
  assert.equal(audit?.payload.path, '/api/v1/teams/:teamId/projects')
  assert.equal(audit?.payload.code, 'OK')
  await runDevops(cli, ['conversation', 'send', room.id, '--file', '-'], {
    text: '确认完成。',
    clientRequestId: randomUUID(),
  })
  await waitFor(readRoomStatus, ({ workStatus }) => workStatus === 'completed')
  assert.equal((await runDevops(cli, ['task', 'inbox'])).count, 0)
  assert.deepEqual(checked(await request(roomPath)).todos, completedTodos)
  assert.equal(executions, 2)
  const usage = await runDevops(cli, ['conversation', 'usage', room.id])
  // faux 输入用量为零；输出用量仍由运行结果累计。
  assert.equal(usage.inputTokens, 0)
  assert.ok(usage.outputTokens > 0)
  assert.equal(usage.contexts[0].botId, bot.id)
  assert.deepEqual((await runDevops(cli, ['conversation', 'queued-inputs', room.id])).items, [])
  const tokens = await waitFor(
    () =>
      app.db
        .select({
          runId: botRunToken.run_id,
          botId: botRunToken.bot_id,
          userId: botRunToken.user_id,
          hash: botRunToken.token_hash,
          revokedAt: botRunToken.revoked_at,
        })
        .from(botRunToken)
        .limit(10),
    (rows) => rows.length === 2 && rows.every(({ revokedAt }) => revokedAt !== null),
  )
  for (const row of tokens) {
    assert.equal(row.botId, bot.id)
    assert.equal(row.userId, user.id)
    assert.match(row.hash, /^[a-f0-9]{64}$/u)
  }
  assert.ok(tokens.some(({ runId }) => runId === sent.runId))
  // 旧任务仅作为升级遗留数据写入夹具；业务链路全部通过会话消息推进。
  const taskId = randomUUID()
  await app.db.insert(botTask).values({
    id: taskId,
    team_id: teamId,
    conversation_id: room.id,
    title: '历史核对任务',
    acceptance_criteria: '保留历史验收说明',
    business_owner_id: user.id,
    executor_bot_id: bot.id,
    status: 'completed',
    created_by: user.id,
  })
  assert.equal((await runDevops(cli, ['task', 'list', room.id])).items[0].id, taskId)
  assert.equal((await runDevops(cli, ['task', 'get', taskId])).title, '历史核对任务')
  for (const path of [
    `${roomPath}/tasks`,
    ...['append', 'handoff', 'rerun', 'cancel', 'accept', 'request-changes'].map(
      (action) => `/api/v1/bot-tasks/${taskId}/${action}`,
    ),
  ]) {
    const removed = await post(path, {})
    assert.equal(removed.body.success, false)
    assert.equal(removed.body.code, 'NOT_FOUND')
  }
  assert.equal((await runDevops(cli, ['task', 'get', taskId])).status, 'completed')
  const serialized = JSON.stringify(logs)
  assert.ok(!serialized.includes('Bot 验收项目'))
  assert.ok(!serialized.includes('fixture-only'))
  assert.ok(!serialized.includes('devops-run-'))
  assert.deepEqual(runnerErrors, [])
})
