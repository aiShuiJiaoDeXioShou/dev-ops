import { expect, test } from '@playwright/test'
import { VISUAL_IDS } from './fixtures'
import { installApiMocks } from './mock-api'

function success(data: unknown) {
  return { success: true, code: 'OK', message: 'OK', requestId: 'bot-task-visual-test', data }
}

test('[desktop] [mobile] 从协作任务面板创建和停止运行', async ({ page }, testInfo) => {
  await installApiMocks(page)
  const { teamId, userId } = VISUAL_IDS
  await page.route(`**/api/v1/teams/${teamId}/work-tags*`, (route) =>
    route.fulfill({ json: success({ items: [], nextCursor: null }) }),
  )
  const stamp = '2026-11-17T08:00:00.000Z'
  const roomId = 'da55aa00-0000-4000-8000-000000000031'
  const botId = 'da55aa00-0000-4000-8000-000000000032'
  const taskId = 'da55aa00-0000-4000-8000-000000000033'
  const runId = 'da55aa00-0000-4000-8000-000000000034'
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
  let created = false
  let stopped = false
  const task = () => ({
    id: taskId,
    teamId,
    conversationId: roomId,
    title: '验收交付',
    acceptanceCriteria: '列出交付证据',
    businessOwnerId: userId,
    executorBotId: botId,
    status: stopped ? 'waiting' : 'pending',
    waitReason: stopped ? 'stopped' : null,
    blocked: false,
    version: stopped ? 2 : 1,
    inputVersion: 1,
    createdBy: userId,
    createdAt: stamp,
    updatedAt: stamp,
  })
  const run = () => ({
    id: runId,
    botId,
    triggerUserId: userId,
    inputVersion: 1,
    status: stopped ? 'stopped' : 'queued',
    stopRequested: stopped,
    createdAt: stamp,
    startedAt: null,
    finishedAt: stopped ? stamp : null,
    modelConnectionId: null,
    modelId: null,
    failureKind: null,
    failureMessage: null,
    turns: 0,
    skillVersions: [],
    usage: null,
  })
  const path = `**/api/v1/bot-conversations/${roomId}`
  await page.route(`**/api/v1/teams/${teamId}/bot-conversations*`, (route) =>
    route.fulfill({
      json: success({
        items: [{ ...room, botAvatars: [{ id: botId, avatarKey: 'orbit', enabled: true }], lastMessagePreview: null }],
        nextCursor: null,
      }),
    }),
  )
  await page.route(path, (route) => route.fulfill({ json: success(room) }))
  await page.route(`${path}/messages*`, (route) => route.fulfill({ json: success({ items: [], nextBefore: null }) }))
  await page.route(`${path}/events*`, (route) =>
    route.fulfill({ json: success({ items: [], activeRuns: [], cursor: '0', resetRequired: false }) }),
  )
  await page.route(`${path}/tasks*`, (route) => {
    if (route.request().method() === 'GET')
      return route.fulfill({ json: success({ items: created ? [task()] : [], nextCursor: null }) })
    expect(route.request().postDataJSON()).toMatchObject({
      title: '验收交付',
      acceptanceCriteria: '列出交付证据',
      businessOwnerId: userId,
      executorBotId: botId,
    })
    created = true
    return route.fulfill({ json: success({ task: task(), runId, runStatus: 'queued' }) })
  })
  await page.route(`**/api/v1/teams/${teamId}/bot-inbox`, (route) =>
    route.fulfill({ json: success({ items: [], count: 0 }) }),
  )
  await page.route(`**/api/v1/bot-tasks/${taskId}`, (route) =>
    route.fulfill({
      json: success({
        ...task(),
        inputs: [],
        runs: [run()],
        trace: [],
        tags: [],
        handoffs: [],
        results: [],
        reviews: [],
      }),
    }),
  )
  await page.route(`**/api/v1/bot-runs/${runId}/stop`, (route) => {
    stopped = true
    return route.fulfill({ json: success(run()) })
  })

  await page.goto(`/collaboration/${roomId}`)
  const opener = page.getByRole('button', { name: '任务列表', exact: true })
  await opener.press('Enter')
  const panel = page.getByRole('complementary', { name: '任务面板' })
  await expect(panel.getByText('还没有任务')).toBeVisible()
  await panel.getByRole('button', { name: '新建协作任务' }).press('Enter')
  const form = page.getByRole('dialog', { name: '新建协作任务' })
  await form.getByLabel('任务目标').fill('验收交付')
  await expect(form.getByRole('combobox', { name: '执行者' })).toHaveValue(botId)
  await form.getByLabel('验收条件').fill('列出交付证据')
  await form.getByRole('button', { name: '创建任务', exact: true }).press('Enter')
  await expect(panel.getByText('排队中', { exact: true })).toBeVisible()
  await panel.getByRole('button', { name: '停止运行' }).press('Enter')
  await expect(panel.getByRole('button', { name: '重新运行' })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('bot-task-panel.png') })
  await page.keyboard.press('Escape')
  await expect(opener).toBeFocused()
  await expect(panel).toBeHidden()
})
