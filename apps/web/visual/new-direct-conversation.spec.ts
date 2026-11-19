import type { ApiSuccessData } from '@dev-ops/api-client'
import { expect, test } from '@playwright/test'
import { VISUAL_IDS } from './fixtures'
import { installApiMocks } from './mock-api'

function success(data: unknown) {
  return { success: true, code: 'OK', message: 'OK', requestId: 'new-direct-conversation', data }
}

test('[desktop] [mobile] 会话内打开私聊并复用已有会话', async ({ page }, testInfo) => {
  await installApiMocks(page)
  const { teamId, userId } = VISUAL_IDS
  const stamp = '2026-11-19T08:00:00.000Z'
  const bot = {
    id: 'da55aa00-0000-4000-8000-000000000011',
    teamId,
    name: '小林',
    responsibility: '服务器运维',
    instructions: '',
    avatarKey: 'prism',
    ownerUserId: userId,
    ownerName: '管理员',
    status: 'enabled',
    availability: 'available',
    accessMode: 'sandbox',
    configVersion: 1,
    modelConnectionId: null,
    connectionName: null,
    modelId: 'deepseek-flash',
    updatedAt: stamp,
    lastActiveAt: null,
    skillIds: [],
  } satisfies ApiSuccessData<'/api/v1/bots/{botId}', 'get'>
  const room = {
    id: 'da55aa00-0000-4000-8000-000000000012',
    teamId,
    name: bot.name,
    kind: 'direct',
    leaderBotId: null,
    lastMessageAt: stamp,
    responsibility: '',
    instructions: '',
    tags: [],
    botSettings: [],
    skillReferences: [],
    members: [
      { id: bot.id, name: bot.name, kind: 'bot' },
      { id: userId, name: '管理员', kind: 'user' },
    ],
  } satisfies ApiSuccessData<'/api/v1/bot-conversations/{conversationId}', 'get'>
  const roomUrl = `/collaboration/${room.id}`
  const teamPath = `**/api/v1/teams/${teamId}`
  const roomPath = `**/api/v1/bot-conversations/${room.id}`
  let roomExists = false
  let opens = 0
  let rejectNextOpen = true
  const secondBot = {
    ...bot,
    id: 'da55aa00-0000-4000-8000-000000000015',
    name: '小杨',
    responsibility: '产品经理',
    avatarKey: 'signal',
    availability: 'worker_offline',
  } satisfies ApiSuccessData<'/api/v1/bots/{botId}', 'get'>
  await page.route(`${teamPath}/bots*`, (route) =>
    route.fulfill({ json: success({ items: [secondBot, bot], nextCursor: null }) }),
  )
  await page.route(`${teamPath}/bot-inbox`, (route) => route.fulfill({ json: success({ items: [], count: 0 }) }))
  await page.route(`${teamPath}/bot-conversations*`, (route) => {
    if (route.request().method() === 'POST') {
      expect(route.request().postDataJSON()).toEqual({ kind: 'direct', botId: bot.id })
      if (rejectNextOpen) {
        rejectNextOpen = false
        return route.fulfill({ status: 500, json: {} })
      }
      opens++
      roomExists = true
      return route.fulfill({ json: success(room) })
    }
    const preview = {
      ...room,
      botAvatars: [{ id: bot.id, avatarKey: bot.avatarKey, enabled: true }],
      lastMessagePreview: null,
    }
    return route.fulfill({ json: success({ items: roomExists ? [preview] : [], nextCursor: null }) })
  })
  await page.route(roomPath, (route) => route.fulfill({ json: success(room) }))
  await page.route(`${roomPath}/messages*`, (route) =>
    route.fulfill({ json: success({ items: [], nextBefore: null }) }),
  )
  await page.route(`${roomPath}/tasks*`, (route) => route.fulfill({ json: success({ items: [], nextCursor: null }) }))
  await page.route(`${roomPath}/events*`, (route) =>
    route.fulfill({ json: success({ items: [], cursor: '0', resetRequired: false, activeRuns: [] }) }),
  )

  await page.goto('/collaboration')
  await expect(page.getByRole('heading', { name: '还没有会话' })).toBeVisible()
  const isMobile = testInfo.project.name === 'mobile'
  const listToggle = page.getByRole('button', { name: '打开会话列表' })
  if (isMobile) await listToggle.click()
  const trigger = page.getByRole('button', { name: '新建会话' })
  const picker = page.getByRole('dialog', { name: '新建私聊' })
  const menu = page.getByRole('menu')
  const directItem = menu.getByRole('menuitem', { name: '新建私聊' })
  const groupItem = menu.getByRole('menuitem', { name: '新建群组' })
  async function openPicker() {
    await trigger.press('Enter')
    await directItem.press('Enter')
    await expect(picker).toBeVisible()
  }

  await trigger.press('Enter')
  await expect(groupItem).toBeVisible()
  expect(await directItem.locator('svg').innerHTML()).not.toEqual(await groupItem.locator('svg').innerHTML())
  await menu.screenshot({ path: testInfo.outputPath('new-conversation-menu.png'), animations: 'disabled' })
  await directItem.press('Enter')
  await expect(picker).toBeVisible()
  await expect(page).toHaveURL(/\/collaboration$/)
  const botRow = picker.getByRole('button', { name: /小林/ })
  await expect(botRow).toContainText('服务器运维')
  await expect(botRow).toContainText(bot.modelId)
  await expect(botRow).toContainText('可用')
  await expect(picker.getByRole('button', { name: /小杨/ })).toContainText('环境离线')
  expect((await botRow.boundingBox())?.height).toBeGreaterThanOrEqual(56)
  expect(await picker.evaluate((dialog) => dialog.contains(document.activeElement))).toBe(true)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('new-direct-conversation.png'), animations: 'disabled' })
  await page.evaluate(() => document.documentElement.classList.add('dark'))
  await picker.screenshot({ path: testInfo.outputPath('new-direct-conversation-dark.png'), animations: 'disabled' })
  await page.evaluate(() => document.documentElement.classList.remove('dark'))
  await page.keyboard.press('Escape')
  await expect(picker).toHaveCount(0)
  await expect(trigger).toBeFocused()

  await openPicker()
  await picker.getByRole('button', { name: /小林/ }).press('Enter')
  const failure = picker.getByRole('alert').filter({ hasText: '打开对话失败' })
  await expect(failure).toBeVisible()
  await expect(page).toHaveURL(/\/collaboration$/)
  await failure.getByRole('button', { name: '重新检查' }).click()
  await expect(page).toHaveURL(new RegExp(`${roomUrl}$`))
  await expect(picker).toHaveCount(0)
  await expect(page.getByRole('tabpanel', { name: '对话' }).getByRole('heading', { name: bot.name })).toBeVisible()
  if (isMobile) await expect(listToggle).toBeFocused()
  if (isMobile) await listToggle.click()
  const roomItem = page.getByRole('complementary', { name: '会话列表' }).getByRole('button', { name: /小林/ })
  await expect(roomItem).toHaveAttribute('aria-pressed', 'true')

  await openPicker()
  await picker.getByRole('button', { name: /小林/ }).click()
  await expect(picker).toHaveCount(0)
  await expect(page).toHaveURL(new RegExp(`${roomUrl}$`))
  if (isMobile) await listToggle.click()
  await expect(roomItem).toHaveCount(1)
  expect(opens).toBe(2)
})
