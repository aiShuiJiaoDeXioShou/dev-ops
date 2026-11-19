import { expect, test } from '@playwright/test'
import { VISUAL_IDS } from './fixtures'
import { installApiMocks } from './mock-api'

function success(data: unknown) {
  return { success: true, code: 'OK', message: 'OK', requestId: 'bot-inbox-visual-test', data }
}

test('[desktop] [mobile] 待处理链接打开任务并验收结果', async ({ page }, testInfo) => {
  await installApiMocks(page)
  const { teamId, userId } = VISUAL_IDS
  await page.route(`**/api/v1/teams/${teamId}/work-tags*`, (route) =>
    route.fulfill({ json: success({ items: [], nextCursor: null }) }),
  )
  const stamp = '2026-11-17T08:00:00.000Z'
  const roomId = 'da55aa00-0000-4000-8000-000000000041'
  const botId = 'da55aa00-0000-4000-8000-000000000042'
  const taskId = 'da55aa00-0000-4000-8000-000000000043'
  const runId = 'da55aa00-0000-4000-8000-000000000044'
  const resultId = 'da55aa00-0000-4000-8000-000000000045'
  const room = {
    id: roomId,
    teamId,
    kind: 'group',
    name: '研发协作平台协作组',
    leaderBotId: botId,
    lastMessageAt: stamp,
    responsibility: '',
    instructions: '',
    tags: [],
    botSettings: [],
    skillReferences: [],
    members: [
      { id: userId, name: '业务负责人', kind: 'user' },
      { id: botId, name: '交付助理', kind: 'bot', avatarKey: 'orbit' },
      { id: 'da55aa00-0000-4000-8000-000000000047', name: '实施助理', kind: 'bot', avatarKey: 'prism' },
      { id: 'da55aa00-0000-4000-8000-000000000048', name: '复核助理', kind: 'bot', avatarKey: 'signal' },
    ],
  }
  const result = {
    id: resultId,
    taskId,
    runId,
    body: '**已核对**，记录可复核。',
    completionNote: '核对完成',
    evidence: [],
    submittedByBotId: botId,
    createdAt: stamp,
  }
  const review = {
    id: 'da55aa00-0000-4000-8000-000000000046',
    resultId,
    decision: 'accepted',
    comment: '通过',
    reviewerUserId: userId,
    createdAt: stamp,
  }
  let accepted = false
  const task = () => ({
    id: taskId,
    teamId,
    conversationId: roomId,
    title: '核对交付',
    acceptanceCriteria: '保留复核记录',
    businessOwnerId: userId,
    executorBotId: botId,
    status: accepted ? 'completed' : 'awaiting_review',
    waitReason: null,
    blocked: false,
    version: accepted ? 4 : 3,
    inputVersion: 1,
    createdBy: userId,
    createdAt: stamp,
    updatedAt: stamp,
  })
  const path = `**/api/v1/bot-conversations/${roomId}`
  const messages = [
    {
      speakerKind: 'bot',
      speakerId: botId,
      speakerName: '交付助理',
      text: '已创建交付核对任务，结果会在当前会话送验。',
    },
    { speakerKind: 'user', speakerId: userId, speakerName: '业务负责人', text: '请保留核对记录和验收证据。' },
    {
      speakerKind: 'bot',
      speakerId: botId,
      speakerName: '交付助理',
      text: '已更新任务「核对交付」，请查看当前任务中的结果。',
    },
  ].map(({ text, ...message }, index) => ({
    ...message,
    id: `da55aa00-0000-4000-8000-00000000008${index}`,
    sequence: String(index + 1),
    body: { blocks: [{ type: 'text', text }] },
    createdAt: stamp,
    runId: null,
  }))
  await page.route(`**/api/v1/teams/${teamId}/bot-conversations*`, (route) =>
    route.fulfill({
      json: success({
        items: [
          {
            ...room,
            botAvatars: room.members.flatMap(({ id, avatarKey }) =>
              avatarKey ? [{ id, avatarKey, enabled: true }] : [],
            ),
            lastMessagePreview: '已更新任务「核对交付」，请查看当前任务中的结果。',
          },
        ],
        nextCursor: null,
      }),
    }),
  )
  await page.route(path, (route) => route.fulfill({ json: success(room) }))
  await page.route(`${path}/messages*`, (route) =>
    route.fulfill({ json: success({ items: messages, nextBefore: null }) }),
  )
  await page.route(`${path}/events*`, (route) =>
    route.fulfill({ json: success({ items: [], activeRuns: [], cursor: '0', resetRequired: false }) }),
  )
  await page.route(`${path}/tasks*`, (route) => route.fulfill({ json: success({ items: [task()], nextCursor: null }) }))
  await page.route(`**/api/v1/teams/${teamId}/bot-inbox`, (route) =>
    route.fulfill({
      json: success(
        accepted
          ? { items: [], count: 0 }
          : {
              count: 1,
              items: [
                {
                  id: taskId,
                  conversationId: roomId,
                  conversationName: room.name,
                  taskTitle: '核对交付',
                  updatedAt: stamp,
                  reason: 'awaiting_review',
                },
              ],
            },
      ),
    }),
  )
  await page.route(`**/api/v1/bot-tasks/${taskId}`, (route) =>
    route.fulfill({
      json: success({
        ...task(),
        inputs: [],
        runs: [],
        trace: [],
        tags: [],
        handoffs: [],
        results: [result],
        reviews: accepted ? [review] : [],
      }),
    }),
  )
  await page.route(`**/api/v1/bot-tasks/${taskId}/accept`, (route) => {
    expect(route.request().postDataJSON()).toEqual({ resultId, comment: '通过' })
    accepted = true
    return route.fulfill({ json: success({ task: task(), review }) })
  })
  await page.goto('/collaboration?view=inbox')
  const link = page.getByRole('link', { name: /核对交付/ })
  await expect(link).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('bot-inbox.png') })
  await link.press('Enter')
  const panel = page.getByRole('complementary', { name: '任务面板' })
  await expect(page.locator('.dsh-title .bot-group-avatar.members-3 img')).toHaveCount(3)
  await expect(page.getByText('3 位 Bot · Leader 交付助理')).toBeVisible()
  await expect(panel.getByText('当前任务')).toBeVisible()
  await expect(page.locator('.dsh-messages article')).toHaveCount(3)
  if (testInfo.project.name === 'desktop') {
    const rail = await page.getByRole('complementary', { name: '会话列表' }).boundingBox()
    expect(rail?.width).toBe(280)
    const header = await page.locator('.dsh-chat-header').boundingBox()
    const tasks = await panel.boundingBox()
    if (!rail || !header || !tasks) throw new Error('协作三栏未完整渲染')
    expect(header.x).toBeCloseTo(rail.x + rail.width, 0)
    expect(tasks.x).toBeCloseTo(header.x + header.width, 0)
  }
  await page.screenshot({ path: testInfo.outputPath('bot-group-task-panel.png'), animations: 'disabled' })
  await expect(panel.getByText('已核对', { exact: true })).toBeVisible()
  await panel.getByRole('button', { name: '验收通过' }).press('Enter')
  const dialog = page.getByRole('dialog', { name: '验收通过' })
  await dialog.getByLabel('验收意见（可选）').fill('通过')
  await dialog.getByRole('button', { name: '验收通过', exact: true }).press('Enter')
  await expect(panel.getByText('已完成', { exact: true })).toBeVisible()
  await page.goto('/collaboration?view=inbox')
  await expect(page.getByText('暂无待处理任务', { exact: true })).toBeVisible()
})
