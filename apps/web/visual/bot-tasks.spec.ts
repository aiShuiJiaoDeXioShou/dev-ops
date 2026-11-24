import { expect, test } from '@playwright/test'
import { VISUAL_IDS } from './fixtures'
import { installApiMocks } from './mock-api'

function success(data: unknown) {
  return { success: true, code: 'OK', message: 'OK', requestId: 'bot-todo-visual-test', data }
}

test('[desktop] [mobile] 长工作直接发送消息，待办实时更新且刷新保留', async ({ page }, testInfo) => {
  await installApiMocks(page)
  const { teamId, userId } = VISUAL_IDS
  const stamp = '2026-11-17T08:00:00.000Z'
  const roomId = 'da55aa00-0000-4000-8000-000000000031'
  const botId = 'da55aa00-0000-4000-8000-000000000032'
  const messageId = 'da55aa00-0000-4000-8000-000000000033'
  const runId = 'da55aa00-0000-4000-8000-000000000034'
  let sent = false
  let checked = false
  let stopped = false
  const room = () => ({
    id: roomId,
    teamId,
    kind: 'direct',
    name: '交付助理',
    leaderBotId: null,
    lastMessageAt: stamp,
    responsibility: '',
    instructions: '',
    tags: [],
    botSettings: [],
    skillReferences: [],
    todos: sent
      ? [
          { text: '读取交付记录', status: checked ? 'completed' : 'in_progress' },
          { text: '核对验收证据', status: 'pending' },
        ]
      : [],
    members: [
      { id: userId, name: '负责人', kind: 'user' },
      { id: botId, name: '交付助理', kind: 'bot' },
    ],
  })
  const message = {
    id: messageId,
    sequence: '1',
    speakerKind: 'user',
    speakerId: userId,
    speakerName: '负责人',
    createdAt: stamp,
    runId,
    body: { blocks: [{ type: 'text', text: '核对交付并列出证据' }] },
  }
  const path = `**/api/v1/bot-conversations/${roomId}`
  await page.route(`**/api/v1/teams/${teamId}/bot-conversations*`, (route) =>
    route.fulfill({
      json: success({
        items: [
          {
            ...room(),
            workStatus: sent && !stopped ? 'running' : 'completed',
            botAvatars: [],
            lastMessagePreview: null,
          },
        ],
        nextCursor: null,
      }),
    }),
  )
  await page.route(path, (route) => route.fulfill({ json: success(room()) }))
  await page.route(`${path}/messages*`, (route) => {
    if (route.request().method() === 'GET')
      return route.fulfill({ json: success({ items: sent ? [message] : [], nextBefore: null }) })
    expect(route.request().postDataJSON().text).toBe('核对交付并列出证据')
    sent = true
    return route.fulfill({ json: success({ message, runId, delivery: 'queued' }) })
  })
  await page.route(`${path}/events*`, (route) =>
    route.fulfill({
      json: success({
        items: [],
        activeRuns: sent && !stopped ? [{ id: runId, botId, status: 'running' }] : [],
        cursor: '0',
        resetRequired: false,
      }),
    }),
  )
  await page.route(`**/api/v1/bot-runs/${runId}/stop`, (route) => {
    stopped = true
    return route.fulfill({ json: success({ id: runId, status: 'stopped' }) })
  })
  await page.goto(`/collaboration/${roomId}`)
  await expect(page.getByRole('button', { name: '任务列表', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '消息操作' })).toHaveCount(0)
  await expect(page.getByRole('region', { name: '工作待办' })).toHaveCount(0)
  const composer = page.getByRole('textbox', { name: '协作消息' })
  await composer.fill('核对交付并列出证据')
  await composer.press('Enter')
  const todos = page.getByRole('region', { name: '工作待办' })
  await expect(todos).toContainText('工作待办 · 0/2')
  await expect(todos).toContainText('进行中 · 读取交付记录')
  checked = true
  await expect(todos).toContainText('工作待办 · 1/2')
  await expect(todos.locator('s')).toHaveText('读取交付记录')
  await page.reload()
  await expect(todos).toContainText('工作待办 · 1/2')
  const todoBox = await todos.boundingBox()
  const composerBox = await composer.boundingBox()
  if (!todoBox || !composerBox) throw new Error('工作待办或输入区未渲染')
  expect(todoBox.y + todoBox.height).toBeLessThanOrEqual(composerBox.y)
  await page.getByRole('button', { name: '停止生成', exact: true }).click()
  await expect(page.getByRole('button', { name: '停止生成', exact: true })).toHaveCount(0)
  await expect(todos).toContainText('待完成 · 核对验收证据')
  await expect(page.getByRole('button', { name: '验收通过' })).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('conversation-persisted-todos.png') })
})
