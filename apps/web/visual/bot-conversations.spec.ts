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
  const eventsPath = `**/api/v1/bot-conversations/${room.id}/events`
  await page.route(`**/api/v1/teams/${teamId}/bot-conversations*`, (route) => {
    const filtered = new URL(route.request().url()).searchParams.get('tagId') === tagId
    return route.fulfill({ json: success({ items: filtered ? [] : [room], nextCursor: null }) })
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
      { sequence: '2', kind: 'output_delta', runId, payload: { text: '正在检查' }, createdAt: stamp },
      { sequence: '3', kind: 'message_committed', runId, payload: {}, createdAt: stamp },
    ]
    const cursor = { empty: 0, queued: 1, running: 2, complete: 3 }[stage]
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
    await toggle.press('Enter')
    await expect(page.getByRole('searchbox', { name: '搜索会话' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(toggle).toBeFocused()
  }
  const composer = page.getByRole('textbox', { name: '协作消息' })
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
  await page.getByRole('combobox', { name: '按工作标签筛选' }).selectOption(tagId)
  await expect(page.getByText('没有匹配的会话')).toBeVisible()
  await page.goto(`/collaboration/${room.id}?skill=${skillId}`)
  await expect(page.getByRole('textbox', { name: '协作消息' })).toHaveValue('@delivery-review ')
})
