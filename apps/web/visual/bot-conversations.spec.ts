import { expect, test } from '@playwright/test'
import type { ApiSuccessData } from '@dev-ops/api-client'
import { VISUAL_IDS } from './fixtures'
import { installApiMocks } from './mock-api'

type Room = ApiSuccessData<'/api/v1/bot-conversations/{conversationId}', 'get'>
type Message = ApiSuccessData<'/api/v1/bot-conversations/{conversationId}/messages', 'get'>['items'][number]

function success(data: unknown) {
  return { success: true, code: 'OK', message: 'OK', requestId: 'conversation-visual-test', data }
}

test('[desktop] [mobile] 私聊沿用原型并展示排队、增量与最终消息', async ({ page }, testInfo) => {
  await installApiMocks(page)
  const { teamId, userId } = VISUAL_IDS
  const tagId = 'da55aa00-0000-4000-8000-000000000090'
  await page.route(`**/api/v1/teams/${teamId}/work-tags*`, (route) =>
    route.fulfill({
      json: success({ items: [{ id: tagId, name: '交付', updatedAt: '2026-11-17T08:00:00.000Z' }], nextCursor: null }),
    }),
  )
  const stamp = '2026-11-17T08:00:00.000Z'
  const botId = 'da55aa00-0000-4000-8000-000000000011'
  const skillId = 'da55aa00-0000-4000-8000-000000000014'
  const runId = 'da55aa00-0000-4000-8000-000000000020'
  const room: Room = {
    id: 'da55aa00-0000-4000-8000-000000000012',
    teamId,
    name: '验收助理',
    kind: 'direct',
    leaderBotId: null,
    lastMessageAt: stamp,
    responsibility: '',
    instructions: '',
    tags: [],
    skillReferences: [
      { id: skillId, name: '交付复核', identifier: 'delivery-review', summary: '核对证据', botIds: [botId] },
    ],
    members: [
      { id: botId, name: '验收助理', kind: 'bot' },
      { id: userId, name: '负责人', kind: 'user' },
    ],
  }
  let stage: 'empty' | 'queued' | 'running' | 'complete' = 'empty'
  const list: Message[] = []
  await page.route(`**/api/v1/teams/${teamId}/bot-inbox`, (route) =>
    route.fulfill({ json: success({ items: [], count: 0 }) }),
  )
  const messagePath = `**/api/v1/bot-conversations/${room.id}/messages`
  await page.route(`**/api/v1/bot-conversations/${room.id}/tasks*`, (route) =>
    route.fulfill({ json: success({ items: [], nextCursor: null }) }),
  )
  const eventsPath = `**/api/v1/bot-conversations/${room.id}/events`
  await page.route(`**/api/v1/teams/${teamId}/bot-conversations*`, (route) => {
    const filtered = new URL(route.request().url()).searchParams.get('tagId') === tagId
    return route.fulfill({
      json: success({
        items: filtered
          ? []
          : [
              {
                ...room,
                botAvatars: [{ id: botId, avatarKey: 'orbit', enabled: true }],
                lastMessagePreview: list.at(-1)?.body.blocks[0]?.text ?? null,
              },
            ],
        nextCursor: null,
      }),
    })
  })
  await page.route(`**/api/v1/bot-conversations/${room.id}`, (route) => route.fulfill({ json: success(room) }))
  await page.route(`${messagePath}*`, (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: success({ items: list, nextBefore: null }) })
    const input = route.request().postDataJSON()
    expect(input).toMatchObject({ text: '@验收助理 检查结果', mentionBotId: botId })
    expect(input.clientRequestId).toBeTruthy()
    const message: Message = {
      id: 'da55aa00-0000-4000-8000-000000000021',
      sequence: '1',
      speakerKind: 'user',
      speakerId: userId,
      speakerName: '负责人',
      body: { blocks: [{ type: 'text', text: input.text }] },
      runId,
      createdAt: stamp,
    }
    list.push(message)
    stage = 'queued'
    return route.fulfill({ json: success({ message, runId }) })
  })
  await page.route(`${eventsPath}*`, (route) => {
    const after = Number(new URL(route.request().url()).searchParams.get('after') ?? '0')
    const allEvents = [
      { sequence: '1', kind: 'run_status', runId, payload: { status: 'queued' }, createdAt: stamp },
      { sequence: '2', kind: 'run_status', runId, payload: { status: 'running', botId }, createdAt: stamp },
      { sequence: '3', kind: 'output_delta', runId, payload: { text: '正在检查' }, createdAt: stamp },
      { sequence: '4', kind: 'run_status', runId, payload: { status: 'succeeded' }, createdAt: stamp },
      { sequence: '5', kind: 'message_committed', runId, payload: {}, createdAt: stamp },
    ]
    const cursor = { empty: 0, queued: 1, running: 3, complete: 5 }[stage]
    const activeRuns =
      stage === 'empty' || stage === 'complete'
        ? []
        : [
            {
              id: runId,
              botId,
              status: stage,
              ...(stage === 'queued' ? { queueReason: 'worker_offline', teamQueuePosition: 2 } : {}),
            },
          ]
    return route.fulfill({
      json: success({
        items: allEvents.slice(after, cursor),
        cursor: String(cursor),
        resetRequired: false,
        activeRuns,
      }),
    })
  })

  await page.goto(`/collaboration/${room.id}`)
  await expect(page.getByRole('tab', { name: '对话' })).toBeVisible()
  if (testInfo.project.name === 'mobile') {
    const toggle = page.getByRole('button', { name: '打开会话列表' })
    await expect(page.getByRole('button', { name: '打开导航', exact: true })).toHaveCount(0)
    await toggle.press('Enter')
    await expect(page.getByRole('searchbox', { name: '搜索会话' })).toBeVisible()
    await page.getByRole('button', { name: '打开导航', exact: true }).press('Enter')
    await expect(page.getByRole('dialog', { name: '工作区导航' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(toggle).toBeFocused()
  }
  const composer = page.getByRole('textbox', { name: '协作消息' })
  await expect(composer).toHaveCSS('background-image', 'none')
  await composer.fill('@')
  await expect(page.getByRole('group', { name: '引用资源候选' })).toBeVisible()
  await composer.press('Enter')
  await expect(composer).toHaveValue('@验收助理 ')
  await composer.fill('@验收助理 检查结果')
  await page.getByRole('button', { name: '发送消息' }).press('Enter')
  await expect(page.getByText('排队中 · 执行服务离线 · 团队队列第 2 位', { exact: true })).toBeVisible({
    timeout: 3000,
  })
  stage = 'running'
  await expect(page.getByText('正在检查', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '停止生成' })).toBeVisible()
  await expect(page.getByRole('button', { name: '发送消息' })).toHaveCount(0)
  await expect(page.locator('.dsh-send-ring')).toBeVisible()
  await expect(page.locator('.dsh-cursor')).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('bot-conversations-running.png'), animations: 'disabled' })
  await composer.fill('尚未发送的草稿')
  await page.getByRole('tab', { name: '轨迹' }).press('Enter')
  await expect(page.getByRole('region', { name: '运行详情' })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('bot-conversations-trace.png'), animations: 'disabled' })
  await page.getByRole('tab', { name: '对话' }).press('Enter')
  await expect(composer).toHaveValue('尚未发送的草稿')
  list.push({
    id: 'da55aa00-0000-4000-8000-000000000022',
    sequence: '2',
    speakerKind: 'bot',
    speakerId: botId,
    speakerName: '验收助理',
    body: { blocks: [{ type: 'text', text: '**验收结果**：已检查。' }] },
    runId,
    createdAt: stamp,
  })
  stage = 'complete'
  await expect(page.getByText('验收结果', { exact: true })).toBeVisible()
  await expect(page.getByText('正在检查', { exact: true })).toHaveCount(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('bot-conversations.png') })
  if (testInfo.project.name === 'mobile') await page.getByRole('button', { name: '打开会话列表' }).press('Enter')
  await page.getByRole('button', { name: /待你处理/ }).press('Enter')
  if (testInfo.project.name === 'mobile') await page.getByRole('button', { name: '打开会话列表' }).press('Enter')
  await page.locator('.conversation-item').filter({ hasText: room.name }).press('Enter')
  await expect(composer).toHaveValue('尚未发送的草稿')
  if (testInfo.project.name === 'mobile') await page.getByRole('button', { name: '打开会话列表' }).press('Enter')
  await page.getByRole('button', { name: '会话筛选' }).press('Enter')
  await page.getByRole('combobox', { name: '按工作标签筛选' }).selectOption(tagId)
  await expect(page.getByText('没有匹配的会话')).toBeVisible()
  await page.goto(`/collaboration/${room.id}?skill=${skillId}`)
  await expect(page.getByRole('textbox', { name: '协作消息' })).toHaveValue('@delivery-review ')
})

test('[desktop] [mobile] 在对话和轨迹停止生成并保留已经输出的正文', async ({ page }, testInfo) => {
  await installApiMocks(page)
  const { teamId, userId } = VISUAL_IDS
  const stamp = new Date().toISOString()
  const botId = 'da55aa00-0000-4000-8000-000000000061'
  const roomId = 'da55aa00-0000-4000-8000-000000000062'
  const runId = 'da55aa00-0000-4000-8000-000000000063'
  const room: Room = {
    id: roomId,
    teamId,
    kind: 'direct',
    name: '实施助理',
    leaderBotId: null,
    lastMessageAt: stamp,
    responsibility: '',
    instructions: '',
    tags: [],
    skillReferences: [],
    members: [
      { id: userId, kind: 'user', name: '当前成员' },
      { id: botId, kind: 'bot', name: '实施助理', avatarKey: 'orbit', enabled: true },
    ],
  }

  const base = `**/api/v1/bot-conversations/${roomId}`
  let stops = 0
  await page.route(`**/api/v1/teams/${teamId}/bot-conversations*`, (route) =>
    route.fulfill({
      json: success({
        items: [{ ...room, botAvatars: [{ id: botId, avatarKey: 'orbit', enabled: true }], lastMessagePreview: null }],
        nextCursor: null,
      }),
    }),
  )
  await page.route(base, (route) => route.fulfill({ json: success(room) }))
  await page.route(`${base}/tasks*`, (route) => route.fulfill({ json: success({ items: [], nextCursor: null }) }))
  await page.route(`${base}/messages*`, (route) => route.fulfill({ json: success({ items: [], nextBefore: null }) }))
  await page.route(`${base}/events*`, (route) => {
    const after = Number(new URL(route.request().url()).searchParams.get('after') ?? '0')
    const events = [
      { sequence: '1', kind: 'run_status', runId, payload: { status: 'running', botId }, createdAt: stamp },
      { sequence: '2', kind: 'output_delta', runId, payload: { text: '已收到的正文片段' }, createdAt: stamp },
      { sequence: '3', kind: 'run_status', runId, payload: { status: 'stopped', botId }, createdAt: stamp },
    ]
    const cursor = stops ? 3 : 2
    return route.fulfill({
      json: success({
        items: events.slice(after, cursor),
        cursor: String(cursor),
        resetRequired: false,
        activeRuns: stops ? [] : [{ id: runId, botId, status: 'running' }],
      }),
    })
  })
  await page.route(`**/api/v1/bot-runs/${runId}/stop`, (route) => {
    expect(route.request().method()).toBe('POST')
    stops++
    return route.fulfill({
      json: success({
        id: runId,
        botId,
        triggerUserId: userId,
        inputVersion: 0,
        status: 'stopped',
        stopRequested: true,
        createdAt: stamp,
        startedAt: stamp,
        finishedAt: stamp,
        modelConnectionId: null,
        modelId: null,
        failureKind: null,
        failureMessage: null,
        turns: 0,
        skillVersions: [],
        usage: null,
      }),
    })
  })

  await page.goto(`/collaboration/${roomId}`)
  await expect(page.getByText('已收到的正文片段')).toBeVisible()
  if (testInfo.project.name === 'desktop') {
    const nav = page.getByRole('link', { name: '协作', exact: true })
    const body = nav.locator('.nav-bot-body')
    await expect(body).toHaveCSS('animation-name', 'nav-bot-sway')
    await nav.hover()
    await expect(body).toHaveCSS('animation-name', 'nav-bot-greet')
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await expect(body).toHaveCSS('animation-name', 'none')
    await page.getByRole('tab', { name: '轨迹' }).press('Enter')
  }
  await page.getByRole('button', { name: '停止生成' }).press('Enter')
  await expect.poll(() => stops).toBe(1)
  await page.getByRole('tab', { name: '对话' }).press('Enter')
  await expect(page.getByText('已停止生成', { exact: true })).toBeVisible()
  await expect(page.getByText('已收到的正文片段')).toBeVisible()
  await expect(page.getByText('已保留部分结果')).toBeVisible()
  await expect(page.locator('.dsh-send-ring')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '发送消息' })).toBeDisabled()
  await page.screenshot({ path: testInfo.outputPath('bot-conversations-stopped.png'), animations: 'disabled' })
})
