import type { ApiSuccessData } from '@dev-ops/api-client'
import { expect, test } from '@playwright/test'
import { VISUAL_IDS } from './fixtures'
import { installApiMocks } from './mock-api'

type Room = ApiSuccessData<'/api/v1/bot-conversations/{conversationId}', 'get'>
type Message = ApiSuccessData<'/api/v1/bot-conversations/{conversationId}/messages', 'get'>['items'][number]
type Event = ApiSuccessData<'/api/v1/bot-conversations/{conversationId}/events', 'get'>['items'][number]

function success(data: unknown) {
  return { success: true, code: 'OK', message: 'OK', requestId: 'trajectory-visual-test', data }
}

test('[desktop] [mobile] 自动展示最近一次运行并在时间线上查看模型和工具步骤', async ({ page }, testInfo) => {
  await installApiMocks(page)
  const { teamId, userId } = VISUAL_IDS
  const botId = 'da55bb00-0000-4000-8000-000000000011'
  const oldRun = 'da55bb00-0000-4000-8000-000000000020'
  const latestRun = 'da55bb00-0000-4000-8000-000000000021'
  const at = (ms: number) => new Date(Date.UTC(2026, 10, 18, 8) + ms).toISOString()
  const room: Room = {
    id: 'da55bb00-0000-4000-8000-000000000012',
    teamId,
    name: '小林',
    kind: 'direct',
    leaderBotId: null,
    lastMessageAt: at(16_000),
    responsibility: '',
    instructions: '',
    tags: [],
    botSettings: [],
    skillReferences: [],
    members: [
      { id: botId, name: '小林', kind: 'bot' },
      { id: userId, name: '团队成员', kind: 'user' },
    ],
  }
  const runs = [
    { id: oldRun, offset: 0, text: '查一下团队成员', reply: '团队共有 3 位成员。' },
    { id: latestRun, offset: 12_000, text: '我当前有多少个项目？在 devop 团队当中？', reply: '团队共有 4 个项目。' },
  ]
  const messages = runs.flatMap<Message>((run, index) => [
    {
      id: `da55bb00-0000-4000-8000-00000000003${2 * index}`,
      sequence: String(2 * index + 1),
      speakerKind: 'user',
      speakerId: userId,
      speakerName: '团队成员',
      body: { blocks: [{ type: 'text', text: run.text }] },
      runId: run.id,
      createdAt: at(run.offset),
    },
    {
      id: `da55bb00-0000-4000-8000-00000000003${2 * index + 1}`,
      sequence: String(2 * index + 2),
      speakerKind: 'bot',
      speakerId: botId,
      speakerName: room.name,
      body: {
        blocks: [{ type: 'text', text: run.reply }],
        metrics: {
          turns: 2,
          inputTokens: 900,
          outputTokens: 160,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          costUsd: 0,
          durationMs: 3900,
        },
      },
      runId: run.id,
      createdAt: at(run.offset + 4_000),
    },
  ])
  const events: Event[] = []
  function add(runId: string, time: number, kind: Event['kind'], payload: Event['payload']) {
    events.push({ sequence: String(events.length + 1), runId, createdAt: at(time), kind, payload })
  }
  for (const run of runs) {
    const { id, offset } = run
    add(id, offset + 1, 'run_status', { status: 'queued', botId })
    add(id, offset + 100, 'run_status', { status: 'running', botId })
    add(id, offset + 250, 'output_delta', { text: '我会先读取当前团队。' })
    add(id, offset + 550, 'tool_activity', { state: 'started', name: 'get_current_context', callId: 'context' })
    add(id, offset + 950, 'tool_activity', {
      state: 'finished',
      name: 'get_current_context',
      callId: 'context',
      ok: true,
    })
    // 让最近的运行跨越一页真实的事件上限，检查第二页与第一条工具均可查看。
    if (id === latestRun) {
      for (let index = 0; index < 102; index++) {
        add(id, offset + 1_200 + index, 'output_delta', { text: index === 0 ? '已确认团队，准备查询。' : ' ' })
      }
    }
    add(id, offset + 1_600, 'tool_activity', { state: 'started', name: 'platform_api_call', callId: 'api' })
    add(id, offset + 2_500, 'tool_activity', {
      state: 'succeeded',
      name: 'platform_api_call',
      callId: 'audit',
      method: 'GET',
      path: id === latestRun ? '/api/v1/teams/{teamId}/projects' : '/api/v1/teams/{teamId}/members',
      code: 'OK',
    })
    add(id, offset + 2_700, 'tool_activity', { state: 'finished', name: 'platform_api_call', callId: 'api', ok: true })
    add(id, offset + 3_800, 'output_delta', { text: run.reply })
    add(id, offset + 4_000, 'run_status', { status: 'succeeded', botId })
  }
  await page.route(`**/api/v1/teams/${teamId}/bot-inbox`, (route) =>
    route.fulfill({ json: success({ items: [], count: 0 }) }),
  )
  await page.route(`**/api/v1/teams/${teamId}/bot-conversations*`, (route) =>
    route.fulfill({
      json: success({ items: [{ ...room, botAvatars: [], lastMessagePreview: runs.at(-1)?.text }], nextCursor: null }),
    }),
  )
  const path = `**/api/v1/bot-conversations/${room.id}`
  await page.route(path, (route) => route.fulfill({ json: success(room) }))
  await page.route(`${path}/messages*`, (route) =>
    route.fulfill({ json: success({ items: messages, nextBefore: null }) }),
  )
  await page.route(`${path}/tasks*`, (route) => route.fulfill({ json: success({ items: [], nextCursor: null }) }))
  let loadedLatestTail = false
  await page.route(`${path}/events*`, (route) => {
    const query = new URL(route.request().url()).searchParams
    const after = Number(query.get('after') ?? '0')
    const runId = query.get('runId')
    if (runId === latestRun && after >= 100) loadedLatestTail = true
    const items = events
      .filter((event) => Number(event.sequence) > after && (!runId || event.runId === runId))
      .slice(0, 100)
    return route.fulfill({
      json: success({ items, cursor: items.at(-1)?.sequence ?? String(after), resetRequired: false, activeRuns: [] }),
    })
  })

  await page.goto(`/collaboration/${room.id}`)
  await page.getByRole('tab', { name: '轨迹' }).click()
  await expect(page.getByRole('combobox', { name: '运行记录' })).toHaveCount(0)
  const stepList = page.getByRole('list', { name: '运行步骤' })
  const apiStep = stepList.getByRole('button', { name: /platform_api_call/ })
  await expect(apiStep).toContainText('/api/v1/teams/{teamId}/projects')
  expect(loadedLatestTail).toBe(true)
  await expect(stepList.getByRole('button', { name: /get_current_context/ })).toHaveCount(1)
  await expect(apiStep).toHaveCount(1)
  await expect(stepList.getByRole('button', { name: /模型输出/ })).toHaveCount(3)
  await expect(stepList.getByText('查一下团队成员')).toHaveCount(0)
  const filters = page.getByRole('group', { name: '步骤类型' })
  const toolFilter = filters.getByRole('button', { name: '工具调用' })
  await toolFilter.press('Enter')
  await expect(toolFilter).toHaveAttribute('aria-pressed', 'true')
  await expect(stepList.getByRole('button')).toHaveCount(2)
  await filters.getByRole('button', { name: '全部' }).press('Enter')

  await apiStep.press('Enter')
  const detail =
    testInfo.project.name === 'desktop'
      ? page.getByRole('complementary', { name: 'platform_api_call' })
      : page.getByRole('dialog', { name: 'platform_api_call' })
  await expect(detail).toBeVisible()
  await expect(detail.getByText('1.1 秒')).toBeVisible()
  if (testInfo.project.name === 'mobile') {
    await expect.poll(async () => (await detail.boundingBox())?.width).toBe(390)
  }
  await page.screenshot({ path: testInfo.outputPath('bot-trace-detail.png'), animations: 'disabled' })
  await detail.getByRole('tab', { name: '事件' }).click()
  await expect(detail.getByText(/"code": "OK"/)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(detail).toBeHidden()
  await expect(apiStep).toBeFocused()

  const search = page.getByRole('searchbox', { name: '搜索运行轨迹' })
  await expect(search).toBeVisible()
  await search.fill('找不到的内容')
  await expect(page.getByText('没有匹配的步骤')).toBeVisible()
  await page.getByRole('button', { name: '清除筛选' }).click()
  await page.getByRole('button', { name: '定位工具调用' }).press('Enter')
  await expect(
    page.getByRole(testInfo.project.name === 'desktop' ? 'complementary' : 'dialog', { name: 'get_current_context' }),
  ).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(stepList.getByRole('button', { name: /get_current_context/ })).toBeFocused()
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth))
    .toBeLessThanOrEqual(1)
  await page.screenshot({ path: testInfo.outputPath('bot-trace.png'), animations: 'disabled' })
  await page.evaluate(() => document.documentElement.classList.add('dark'))
  await page.screenshot({ path: testInfo.outputPath('bot-trace-dark.png'), animations: 'disabled' })
})
