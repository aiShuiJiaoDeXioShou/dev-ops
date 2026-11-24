import { expect, test, type Page } from '@playwright/test'
import type { ApiSuccessData } from '@dev-ops/api-client'
import { VISUAL_IDS } from './fixtures'
import { installApiMocks } from './mock-api'

type Room = ApiSuccessData<'/api/v1/bot-conversations/{conversationId}', 'get'>
type Message = ApiSuccessData<'/api/v1/bot-conversations/{conversationId}/messages', 'get'>['items'][number]
type Relay = NonNullable<Room['activeRelay']>
const { teamId, userId } = VISUAL_IDS
const roomId = 'c011ab00-0000-4000-8000-000000000001'
const forkId = 'c011ab00-0000-4000-8000-000000000002'
const botId = 'c011ab00-0000-4000-8000-000000000003'
const helperId = 'c011ab00-0000-4000-8000-000000000004'
const runId = 'c011ab00-0000-4000-8000-000000000005'
const relayId = 'c011ab00-0000-4000-8000-000000000006'
const messageId = 'c011ab00-0000-4000-8000-000000000007'
const templateId = 'c011ab00-0000-4000-8000-000000000008'
const connectionId = 'c011ab00-0000-4000-8000-000000000009'
const date = '2026-11-18T08:00:00.000Z'
const teamPath = `**/api/v1/teams/${teamId}`
const roomPath = `**/api/v1/bot-conversations/${roomId}`
const assistant = { id: botId, kind: 'bot', name: '小林', enabled: true } as const
const helper = { id: helperId, kind: 'bot', name: '复核助理', enabled: true } as const
const template = {
  id: templateId,
  teamId,
  name: 'review',
  description: '复核工作',
  body: '复核 $ARGUMENTS',
  updatedAt: date,
}

function ok(data: unknown) {
  return { success: true, code: 'OK', message: '成功', requestId: 'v06-visual', data }
}

function sampleRoom(kind: Room['kind']): Room {
  return {
    id: roomId,
    teamId,
    kind,
    name: kind === 'group' ? '技术协作' : '小林',
    leaderBotId: kind === 'group' ? botId : null,
    lastMessageAt: date,
    responsibility: '',
    instructions: '',
    tags: [],
    skillReferences: [],
    botSettings: [
      {
        botId,
        modelId: 'deepseek-v4-pro',
        thinkingLevel: 'high',
        effectiveThinkingLevel: 'high',
        isOverrideValid: true,
      },
    ],
    members: [...(kind === 'group' ? [assistant, helper] : [assistant]), { id: userId, kind: 'user', name: '开发者' }],
  }
}

function sampleMessage(text: string, extra?: Partial<Message>): Message {
  return {
    id: messageId,
    sequence: '1',
    speakerKind: 'user',
    speakerId: userId,
    speakerName: '开发者',
    runId,
    createdAt: date,
    body: { blocks: [{ type: 'text', text }] },
    ...extra,
  }
}

async function installRoom(page: Page, room: Room) {
  await installApiMocks(page)
  await page.route(`${teamPath}/bot-conversations*`, (route) =>
    route.fulfill({
      json: ok({ items: [{ ...room, botAvatars: [], lastMessagePreview: null }], nextCursor: null }),
    }),
  )
  await page.route(roomPath, (route) => route.fulfill({ json: ok(room) }))
  await page.route(`${roomPath}/tasks*`, (route) => route.fulfill({ json: ok({ items: [], nextCursor: null }) }))
  await page.route(`${teamPath}/bot-inbox*`, (route) => route.fulfill({ json: ok({ items: [], count: 0 }) }))
  await page.route(`${teamPath}/work-tags*`, (route) => route.fulfill({ json: ok({ items: [], nextCursor: null }) }))
}

test('[desktop] [mobile] 群聊顺序点名、插话、暂停继续与轨迹', async ({ page }, testInfo) => {
  const room = sampleRoom('group')
  await installRoom(page, room)
  const timeAt = (seconds: number) => new Date(Date.parse(date) + seconds * 1000).toISOString()
  const messages: Message[] = []
  const relay: Relay = {
    id: relayId,
    status: 'running',
    pendingBotIds: [helperId],
    hopCount: 0,
    replyCount: 0,
    hopLimit: 4,
    replyLimit: 10,
    continueCount: 0,
    version: 1,
  }
  let didStart = false
  let stopped = false
  let cursor = '0'
  await page.route(`${roomPath}/messages*`, (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: ok({ items: messages, nextBefore: null }) })
    const body = route.request().postDataJSON()
    if (!didStart) {
      expect(body.mentionBotIds).toEqual([botId, helperId])
      didStart = true
    } else if (body.text === '先核对权限') {
      expect(body.deliveryMode).toBe('steer')
      relay.status = 'paused'
      relay.hopCount = 4
      relay.replyCount = 7
      relay.version++
    } else {
      expect(body.mentionAll).toBe(true)
    }
    const message = sampleMessage(body.text, {
      id: messages.length ? `c011ab00-0000-4000-8000-00000000010${messages.length}` : messageId,
      sequence: String(messages.length + 1),
    })
    messages.push(message)
    return route.fulfill({
      json: ok({ message, runId, relay, delivery: body.deliveryMode === 'steer' ? 'steer' : 'queued' }),
    })
  })
  await page.route(`${roomPath}/events*`, (route) => {
    const query = new URL(route.request().url()).searchParams
    const items = !didStart
      ? []
      : [
          { sequence: '1', kind: 'run_status', payload: { status: 'running', botId }, createdAt: timeAt(0), runId },
          ...(relay.version > 1
            ? [
                { sequence: '2', kind: 'steer_delivered', payload: { messageId }, createdAt: timeAt(1), runId },
                { sequence: '3', kind: 'resumed', payload: {}, createdAt: timeAt(2), runId },
                { sequence: '4', kind: 'compaction_started', payload: {}, createdAt: timeAt(3), runId },
                {
                  sequence: '5',
                  kind: 'compaction_finished',
                  payload: { tokensBefore: 8000 },
                  createdAt: timeAt(4),
                  runId,
                },
                {
                  sequence: '6',
                  kind: 'mcp_call_started',
                  payload: { callId: 'call', server: 'catalog', tool: 'lookup' },
                  createdAt: timeAt(5),
                  runId,
                },
                {
                  sequence: '7',
                  kind: 'mcp_call_finished',
                  payload: { callId: 'call', server: 'catalog', tool: 'lookup', ok: true },
                  createdAt: timeAt(6),
                  runId,
                },
                { sequence: '8', kind: 'reply_skipped', payload: {}, createdAt: timeAt(7), runId },
              ]
            : []),
          ...(stopped
            ? [
                {
                  sequence: '9',
                  kind: 'run_status',
                  payload: { status: 'stopped', botId },
                  createdAt: timeAt(12),
                  runId,
                },
              ]
            : []),
        ]
    cursor = items.at(-1)?.sequence ?? cursor
    return route.fulfill({
      json: ok({
        items: items.filter(({ sequence }) => Number(sequence) > Number(query.get('after') ?? '0')),
        cursor,
        activeRuns: didStart && !stopped && relay.status === 'running' ? [{ id: runId, botId, status: 'running' }] : [],
        resetRequired: false,
        activeRelay: didStart && !stopped ? relay : undefined,
      }),
    })
  })
  await page.route(`**/api/v1/bot-relays/${relayId}/continue`, (route) => {
    expect(route.request().postDataJSON()).toEqual({ version: relay.version })
    relay.status = 'running'
    relay.version++
    relay.hopCount = 0
    return route.fulfill({ json: ok(relay) })
  })
  await page.route(`**/api/v1/bot-relays/${relayId}/stop`, (route) => {
    expect(route.request().postDataJSON()).toEqual({ version: relay.version })
    stopped = true
    return route.fulfill({ json: ok({ ...relay, status: 'stopped' }) })
  })
  await page.goto(`/collaboration/${roomId}`)
  const input = page.getByRole('textbox', { name: '协作消息' })
  await input.fill('@小林 @复核助理 比对交付计划')
  await input.press('Enter')
  await expect(page.getByRole('region', { name: '群聊接力' })).toContainText('接力进行中')
  await expect(page.getByRole('switch', { name: '插话' })).toHaveCount(0)
  await input.fill('先核对权限')
  await input.press('Enter')
  const relayStatus = page.getByRole('region', { name: '群聊接力' })
  await expect(relayStatus).toContainText('4/4 跳')
  await page.screenshot({ path: testInfo.outputPath('group-relay.png') })
  await page.getByRole('button', { name: '继续接力' }).click()
  await expect(relayStatus).toContainText('接力进行中')
  await page.getByRole('button', { name: '停止生成' }).click()
  await expect(relayStatus).toBeHidden()
  await input.fill('@')
  await page.getByRole('button', { name: '@全部 所有智能体' }).click()
  await input.press('Enter')
  await expect(input).toHaveValue('')
  await page.getByRole('tab', { name: '轨迹' }).click()
  await page.getByRole('button', { name: '运行阶段' }).click()
  await expect(page.getByRole('button', { name: /上下文压缩/ }).last()).toBeVisible()
  await expect(page.getByRole('button', { name: /插话已送达/ }).last()).toBeVisible()
  await expect(page.getByRole('button', { name: /MCP · lookup/ }).last()).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('run-trace.png') })
})

test('[desktop] [mobile] 私聊模板、分叉与会话运行设置', async ({ page }, testInfo) => {
  const room = sampleRoom('direct')
  await installRoom(page, room)
  const first = sampleMessage('审核交付', { branchSiblings: { index: 2, total: 2 } })
  const items = [first]
  await page.route(`${teamPath}/bot-prompt-templates*`, (route) =>
    route.fulfill({ json: ok({ items: [template], nextCursor: null }) }),
  )
  await page.route(`${roomPath}/messages*`, (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: ok({ items, nextBefore: null }) })
    const body = route.request().postDataJSON()
    expect(body).toMatchObject({ promptTemplateId: template.id, text: '/review 交付' })
    const message = sampleMessage(body.text, {
      id: 'c011ab00-0000-4000-8000-000000000011',
      sequence: '2',
      body: {
        blocks: [{ type: 'text', text: body.text }],
        references: { skillIds: [], promptTemplate: { id: template.id, name: template.name, sourceText: body.text } },
      },
    })
    items.push(message)
    return route.fulfill({ json: ok({ message, runId, delivery: 'queued' }) })
  })
  await page.route(`${roomPath}/events*`, (route) =>
    route.fulfill({
      json: ok({ items: [], cursor: '0', activeRuns: [], resetRequired: false }),
    }),
  )
  await page.route(`${roomPath}/fork`, (route) => {
    expect(route.request().postDataJSON()).toEqual({ messageId })
    return route.fulfill({ json: ok({ ...room, id: forkId, name: '审核分叉' }) })
  })
  await page.route(`**/api/v1/bot-conversations/${forkId}`, (route) =>
    route.fulfill({ json: ok({ ...room, id: forkId, name: '审核分叉' }) }),
  )
  await page.route(`**/api/v1/bot-conversations/${forkId}/messages*`, (route) =>
    route.fulfill({ json: ok({ items: [first], nextBefore: null }) }),
  )
  await page.route(`**/api/v1/bots/${botId}`, (route) =>
    route.fulfill({
      json: ok({
        id: botId,
        teamId,
        name: '小林',
        responsibility: '',
        instructions: '',
        avatarKey: null,
        ownerUserId: userId,
        ownerName: null,
        status: 'enabled',
        availability: 'available',
        configVersion: 1,
        skillIds: [],
        modelConnectionId: connectionId,
        modelId: 'deepseek-v4-flash',
        connectionName: '团队模型',
        updatedAt: date,
        lastActiveAt: null,
      }),
    }),
  )
  await page.route(`${teamPath}/bot-model-connections`, (route) =>
    route.fulfill({
      json: ok([
        {
          id: connectionId,
          name: '团队模型',
          providerId: 'deepseek',
          authType: 'api_key',
          status: 'active',
          version: 1,
          disabledReason: null,
          loginUserName: null,
          updatedAt: date,
        },
      ]),
    }),
  )
  await page.route(`${teamPath}/bot-model-catalog*`, (route) =>
    route.fulfill({
      json: ok([
        {
          modelId: 'deepseek-v4-pro',
          displayName: 'DeepSeek V4 Pro',
          providerId: 'deepseek',
          authTypes: ['api_key'],
          contextWindow: 1_000_000,
        },
      ]),
    }),
  )
  await page.route(`${roomPath}/bots/${botId}/settings`, (route) => {
    const body = route.request().postDataJSON()
    expect(body).toEqual({ modelId: 'deepseek-v4-pro', thinkingLevel: 'medium' })
    room.botSettings = [
      {
        botId,
        modelId: 'deepseek-v4-pro',
        thinkingLevel: 'medium',
        effectiveThinkingLevel: null,
        isOverrideValid: true,
      },
    ]
    return route.fulfill({ json: ok({ ...body, botId }) })
  })
  await page.route(`${roomPath}/bots/${botId}/compact`, (route) => route.fulfill({ json: ok({ runId }) }))
  await page.goto(`/collaboration/${roomId}`)
  const input = page.getByRole('textbox', { name: '协作消息' })
  await input.fill('/')
  await page.getByRole('button', { name: '/review 复核工作' }).click()
  await input.fill('/review 交付')
  await input.press('Enter')
  await expect(page.getByText('模板 /review')).toBeVisible()
  const settings = page.getByRole('button', { name: '会话设置', exact: true })
  await settings.click()
  const panel = page.getByRole('complementary', { name: '会话设置' })
  await expect(panel.getByRole('combobox', { name: '思考等级' })).toHaveValue('high')
  await expect(panel.getByText('实际生效模型 deepseek-v4-pro')).toBeVisible()
  await panel.getByRole('combobox', { name: '思考等级' }).selectOption('medium')
  await panel.getByRole('button', { name: '保存运行设置' }).click()
  await expect(panel.getByText('运行设置已保存。')).toBeVisible()
  await panel.getByRole('button', { name: '压缩会话' }).click()
  await expect(panel.getByText('压缩已排队', { exact: false })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('runtime-settings.png') })
  await page.keyboard.press('Escape')
  await expect(settings).toBeFocused()
  const original = page.locator(`#message-${messageId}`)
  await expect(original.getByRole('button', { name: '上一个消息版本' })).toBeEnabled()
  const more = original.getByRole('button', { name: '从这里分叉' })
  await more.press('Enter')
  const dialog = page.getByRole('dialog', { name: '从这里分叉' })
  await expect(dialog).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('fork.png') })
  await page.keyboard.press('Escape')
  await expect(more).toBeFocused()
  await more.press('Enter')
  await dialog.getByRole('button', { name: '创建分叉' }).click()
  await expect(page).toHaveURL(new RegExp(forkId))
})

test('[desktop] [mobile] 能力页可管理上下文、模板、预算与 MCP 授权', async ({ page }, testInfo) => {
  await installApiMocks(page)
  let context = { content: '交付前核对权限。', version: 1, updatedBy: userId, updatedAt: date }
  const mcpId = 'c011ab00-0000-4000-8000-000000000012'
  const server = {
    name: 'team-tools',
    id: mcpId,
    url: 'https://example.com/mcp',
    status: 'enabled',
    botIds: new Array<string>(),
    credentialId: null,
    exposure: 'deferred',
  }
  await page.route(`${teamPath}/bot-context`, (route) => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON()
      expect(body.version).toBe(context.version)
      context = { ...context, content: body.content, version: context.version + 1 }
    }
    return route.fulfill({ json: ok(context) })
  })
  await page.route(`${teamPath}/bot-prompt-templates*`, (route) =>
    route.fulfill({
      json: ok({ items: new URL(route.request().url()).searchParams.has('query') ? [] : [template], nextCursor: null }),
    }),
  )
  const usage = {
    inputTokens: '1200',
    outputTokens: '850',
    cacheReadTokens: '64',
    cacheWriteTokens: '0',
    costUsd: '0.015000',
    costKnown: false,
    unknownCostRuns: 1,
  }
  let limit = '10.0000'
  await page.route(`${teamPath}/bot-usage*`, (route) =>
    route.fulfill({
      json: ok({
        month: new URL(route.request().url()).searchParams.get('month') ?? '2026-11',
        monthlyLimitUsd: limit,
        total: usage,
        byBot: [{ ...usage, botId, name: '小林' }],
        byDay: [{ ...usage, date: '2026-11-18' }],
        nextBotCursor: null,
      }),
    }),
  )
  await page.route(`${teamPath}/bot-budget`, (route) => {
    limit = route.request().postDataJSON().monthlyLimitUsd
    return route.fulfill({ json: ok({ monthlyLimitUsd: limit }) })
  })
  await page.route(`${teamPath}/bot-mcp-servers*`, (route) =>
    route.fulfill({
      json: ok({ items: [server], canManage: true, nextCursor: null }),
    }),
  )
  await page.route(`${teamPath}/bots*`, (route) =>
    route.fulfill({
      json: ok({
        items: [
          {
            id: botId,
            teamId,
            name: '小林',
            responsibility: '',
            instructions: '',
            avatarKey: null,
            ownerUserId: userId,
            ownerName: null,
            status: 'enabled',
            availability: 'available',
            configVersion: 1,
            skillIds: [],
            modelConnectionId: null,
            modelId: null,
            connectionName: null,
            updatedAt: date,
            lastActiveAt: null,
          },
        ],
        nextCursor: null,
      }),
    }),
  )
  await page.route(`**/api/v1/bot-mcp-servers/${mcpId}/test`, (route) =>
    route.fulfill({ json: ok({ isConnected: true, toolCount: 3 }) }),
  )
  await page.route(`**/api/v1/bot-mcp-servers/${mcpId}/update`, (route) => {
    expect(route.request().postDataJSON().botIds).toEqual([botId])
    server.botIds = [botId]
    return route.fulfill({ json: ok(server) })
  })
  await page.goto('/settings/team')
  await page.getByRole('tab', { name: 'Agent 管理', exact: true }).click()
  await expect(page.getByRole('tab', { name: '团队上下文', exact: true })).toHaveAttribute('aria-selected', 'true')
  await page.getByLabel('团队共用指令').fill('先核对权限和影响范围。')
  await page.getByRole('button', { name: '保存上下文' }).press('Enter')
  await expect(page.getByText('已保存。', { exact: true })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('team-context.png') })
  await page.goto('/capabilities/prompt-templates')
  await page.getByRole('button', { name: '编辑 /review' }).click()
  await expect(page.getByRole('dialog').getByLabel('模板正文')).toHaveValue(template.body)
  await page.screenshot({ path: testInfo.outputPath('prompt-template.png') })
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: '编辑 /review' })).toBeFocused()
  await page.getByRole('searchbox', { name: '搜索模板' }).fill('unknown')
  await expect(page.getByText('没有匹配的模板')).toBeVisible()
  await page.goto('/capabilities/usage')
  await expect(page).toHaveURL(/settings\/team\?tab=agents&agentTab=usage$/)
  await expect(page.getByRole('tab', { name: 'Agent 管理', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('tab', { name: '用量与预算', exact: true })).toHaveAttribute('aria-selected', 'true')
  await page.reload()
  await page.getByLabel('统计方式').selectOption('day')
  await expect(page.getByRole('heading', { name: '2026-11-18' })).toBeVisible()
  await page.getByLabel('金额（USD）').fill('24.50')
  await page.getByRole('button', { name: '保存预算' }).click()
  await expect(page.getByText('预算已保存。')).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('bot-usage.png') })
  await page.goto('/settings/team?tab=connections')
  const mcp = page.getByRole('region', { name: 'MCP 服务器' })
  await mcp.getByRole('button', { name: '测试连接' }).click()
  await expect(mcp.getByText('连接成功，发现 3 个工具。')).toBeVisible()
  await mcp.getByRole('button', { name: '编辑 team-tools' }).click()
  await page.getByRole('checkbox', { name: '小林' }).press('Space')
  await expect(page.getByRole('checkbox', { name: '小林' })).toBeChecked()
  await page.screenshot({ path: testInfo.outputPath('remote-mcp.png') })
  await page.keyboard.press('Escape')
  await expect(mcp.getByRole('button', { name: '编辑 team-tools' })).toBeFocused()
  await mcp.getByRole('button', { name: '编辑 team-tools' }).press('Enter')
  await page.getByRole('checkbox', { name: '小林' }).press('Space')
  await page.getByRole('button', { name: '保存服务器' }).click()
  await expect(mcp.getByText('1 个智能体', { exact: false })).toBeVisible()
})

test('[desktop] [mobile] 浏览者可读取团队上下文，失败时可以重试', async ({ page }) => {
  await installApiMocks(page)
  await page.route('**/api/v1/me/teams', (route) =>
    route.fulfill({
      json: ok({
        teams: [
          {
            id: teamId,
            name: 'DevOps 研发团队',
            iconText: null,
            description: null,
            version: 1,
            role: 'viewer',
            status: 'active',
          },
        ],
        isPlatformAdmin: false,
      }),
    }),
  )
  let shouldFail = true
  await page.route(`${teamPath}/bot-context`, (route) =>
    route.fulfill({
      json: shouldFail
        ? { success: false, code: 'INTERNAL_ERROR', message: '暂时不可读', requestId: 'v06-visual' }
        : ok({ content: '共享约定', version: 1, updatedBy: userId, updatedAt: date }),
    }),
  )
  await page.goto('/capabilities/team-context')
  const retry = page.getByRole('button', { name: '重新检查' })
  await expect(retry).toBeVisible()
  shouldFail = false
  await retry.click()
  await expect(page.getByRole('textbox', { name: '团队共用指令' })).toHaveValue('共享约定')
  await expect(page.getByRole('textbox', { name: '团队共用指令' })).not.toBeEditable()
  await expect(page.getByRole('button', { name: '保存上下文' })).toHaveCount(0)
})

test('[desktop] [mobile] 输入区命令、组字、追加及撤回', async ({ page }, testInfo) => {
  const room = sampleRoom('direct')
  await installRoom(page, room)
  let queued = [
    {
      messageId,
      mode: 'follow_up',
      text: '稍后检查',
      attachmentIds: [],
      attachments: [],
      skillIds: [],
      mentionBotIds: [],
      mentionAll: false,
    },
  ]
  const sent: { text: string; deliveryMode?: string }[] = []
  await page.route(`${roomPath}/queued-inputs`, (route) => route.fulfill({ json: ok({ items: queued }) }))
  await page.route(`${roomPath}/events*`, (route) =>
    route.fulfill({
      json: ok({ cursor: '0', items: [], activeRuns: [{ id: runId, botId, status: 'running' }], resetRequired: false }),
    }),
  )
  await page.route(`${roomPath}/messages*`, (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: ok({ items: [], nextBefore: null }) })
    sent.push(route.request().postDataJSON())
    return route.fulfill({ json: ok({ message: sampleMessage(sent.at(-1)?.text ?? ''), runId, delivery: 'steer' }) })
  })
  await page.route(`${roomPath}/messages/${messageId}/withdraw`, (route) => {
    const item = queued[0]
    queued = []
    return route.fulfill({ json: ok(item) })
  })
  await page.route(`${teamPath}/bot-prompt-templates*`, (route) => route.fulfill({ json: ok({ items: [template] }) }))
  await page.goto(`/collaboration/${roomId}`)
  const input = page.getByRole('textbox', { name: '协作消息' })
  await expect(input).toBeVisible({ timeout: 15000 })
  await expect(page.getByRole('button', { name: '消息操作' })).toHaveCount(0)
  await input.fill('/')
  await expect(page.getByRole('group', { name: '会话命令候选' })).toContainText('/model')
  await input.press('Escape')
  await input.fill('中文组字')
  await input.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true })
  expect(sent).toHaveLength(0)
  await input.press('Enter')
  await expect.poll(() => sent.length).toBe(1)
  expect(sent[0]?.deliveryMode).toBe('steer')
  await input.fill('下一项')
  await input.press('Alt+Enter')
  await expect.poll(() => sent.length).toBe(2)
  expect(sent[1]?.deliveryMode).toBe('auto')
  await page.getByRole('button', { name: '撤回到输入框' }).click()
  await expect(input).toHaveValue('稍后检查')
  await expect(page.getByText('本会话费用：', { exact: false })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('v010-composer.png'), fullPage: true })
  await input.fill('/session')
  await input.press('Enter')
  await expect(page.getByRole('dialog', { name: '/session' })).toContainText('120')
  await page.keyboard.press('Escape')
  await expect(input).toBeFocused()
})

test('[desktop] [mobile] new 命令创建独立会话并保留原房间', async ({ page }) => {
  const room = sampleRoom('direct')
  await installRoom(page, room)
  await page.route(`${roomPath}/messages*`, (route) => route.fulfill({ json: ok({ items: [], nextBefore: null }) }))
  await page.route(`${roomPath}/events*`, (route) =>
    route.fulfill({ json: ok({ cursor: '0', items: [], activeRuns: [], resetRequired: false }) }),
  )
  let created = false
  await page.route(`${teamPath}/bot-conversations`, (route) => {
    if (route.request().method() !== 'POST') return route.fallback()
    expect(route.request().postDataJSON()).toEqual({ kind: 'direct', botId, newSession: true })
    created = true
    return route.fulfill({ json: ok({ ...room, id: forkId }) })
  })
  await page.route(`**/api/v1/bot-conversations/${forkId}`, (route) =>
    route.fulfill({ json: ok({ ...room, id: forkId }) }),
  )
  await page.route(`**/api/v1/bot-conversations/${forkId}/messages*`, (route) =>
    route.fulfill({ json: ok({ items: [], nextBefore: null }) }),
  )
  await page.goto(`/collaboration/${roomId}`)
  const input = page.getByRole('textbox', { name: '协作消息' })
  await input.fill('/new')
  await input.press('Enter')
  const dialog = page.getByRole('dialog', { name: '/new' })
  await expect(dialog).toContainText('原会话及消息历史会保留')
  await dialog.getByRole('button', { name: /确认/ }).click()
  await expect(page).toHaveURL(new RegExp(forkId))
  expect(created).toBe(true)
})

test('[desktop] [mobile] 浏览者命令只读且关闭后归还键盘焦点', async ({ page }) => {
  await installRoom(page, sampleRoom('direct'))
  await page.route('**/api/v1/me/teams', (route) =>
    route.fulfill({
      json: ok({
        teams: [
          {
            id: teamId,
            name: '研发团队',
            iconText: null,
            description: null,
            version: 1,
            role: 'viewer',
            status: 'active',
          },
        ],
        isPlatformAdmin: false,
      }),
    }),
  )
  await page.route(`${roomPath}/messages*`, (route) => route.fulfill({ json: ok({ items: [], nextBefore: null }) }))
  let failed = true
  await page.route(`${roomPath}/usage`, (route) =>
    route.fulfill({
      json: failed
        ? { success: false, code: 'INTERNAL_ERROR', message: '暂不可用', requestId: 'usage-retry' }
        : ok({ inputTokens: 20, outputTokens: 10, costUsd: null, contexts: [] }),
    }),
  )
  await page.goto(`/collaboration/${roomId}`)
  await expect(page.getByRole('textbox', { name: '协作消息' })).toHaveCount(0)
  const session = page.getByRole('button', { name: '/session', exact: true })
  await session.press('Enter')
  const dialog = page.getByRole('dialog', { name: '/session' })
  await expect(dialog.getByRole('button', { name: '用量加载失败，重试' })).toBeVisible()
  failed = false
  await dialog.getByRole('button', { name: '用量加载失败，重试' }).click()
  await expect(dialog).toContainText('20')
  await page.keyboard.press('Escape')
  await expect(session).toBeFocused()
  const copy = page.getByRole('button', { name: '/copy', exact: true })
  await copy.press('Enter')
  await expect(page.getByRole('dialog', { name: '/copy' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(copy).toBeFocused()
  await expect(page.getByRole('button', { name: '/model', exact: true })).toHaveCount(0)
})
