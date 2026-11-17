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
    kind: 'direct',
    name: '交付助理',
    leaderBotId: null,
    lastMessageAt: stamp,
    responsibility: '',
    instructions: '',
    tags: [],
    skillReferences: [],
    members: [
      { id: userId, name: '业务负责人', kind: 'user' },
      { id: botId, name: '交付助理', kind: 'bot' },
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
  await page.route(`**/api/v1/teams/${teamId}/bot-conversations*`, (route) =>
    route.fulfill({ json: success({ items: [room], nextCursor: null }) }),
  )
  await page.route(path, (route) => route.fulfill({ json: success(room) }))
  await page.route(`${path}/messages*`, (route) => route.fulfill({ json: success({ items: [], nextBefore: null }) }))
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
  await link.click()
  const panel = page.getByRole('complementary', { name: '任务面板' })
  await expect(panel.getByText('已核对', { exact: true })).toBeVisible()
  await panel.getByRole('button', { name: '验收通过' }).click()
  const dialog = page.getByRole('dialog', { name: '验收通过' })
  await dialog.getByLabel('验收意见（可选）').fill('通过')
  await dialog.getByRole('button', { name: '验收通过', exact: true }).click()
  await expect(panel.getByText('已完成', { exact: true })).toBeVisible()
  await page.goto('/collaboration?view=inbox')
  await expect(page.getByText('暂无待处理任务', { exact: true })).toBeVisible()
})
