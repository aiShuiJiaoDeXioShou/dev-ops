import type { ApiSuccessData } from '@dev-ops/api-client'
import { expect, test } from '@playwright/test'
import { VISUAL_IDS } from './fixtures'
import { installApiMocks } from './mock-api'

function success(data: unknown) {
  return { success: true, code: 'OK', message: 'OK', requestId: 'collaboration-loading', data }
}

test('[desktop] [mobile] 协作首屏按会话分栏加载，等待消息时保留已就绪的输入区', async ({ page }, testInfo) => {
  await installApiMocks(page)
  const { teamId, userId } = VISUAL_IDS
  const room = {
    id: 'da55aa00-0000-4000-8000-000000000061',
    teamId,
    name: '验收助理',
    kind: 'direct',
    leaderBotId: null,
    lastMessageAt: '2026-11-17T08:00:00.000Z',
    responsibility: '',
    instructions: '',
    tags: [],
    botSettings: [],
    skillReferences: [],
    members: [{ id: userId, kind: 'user', name: '当前成员' }],
  } satisfies ApiSuccessData<'/api/v1/bot-conversations/{conversationId}', 'get'>

  const auth = Promise.withResolvers<void>()
  const teams = Promise.withResolvers<void>()
  const list = Promise.withResolvers<void>()
  const detail = Promise.withResolvers<void>()
  const messages = Promise.withResolvers<void>()
  const roomPath = `**/api/v1/bot-conversations/${room.id}`
  await page.route('**/api/v1/auth/get-session', async (route) => {
    await auth.promise
    await route.fallback()
  })
  await page.route('**/api/v1/me/teams', async (route) => {
    await teams.promise
    await route.fallback()
  })
  await page.route(`**/api/v1/teams/${teamId}/bot-conversations*`, async (route) => {
    await list.promise
    await route.fulfill({
      json: success({ items: [{ ...room, botAvatars: [], lastMessagePreview: null }], nextCursor: null }),
    })
  })
  await page.route(roomPath, async (route) => {
    await detail.promise
    await route.fulfill({ json: success(room) })
  })
  await page.route(`${roomPath}/messages*`, async (route) => {
    await messages.promise
    await route.fulfill({ json: success({ items: [], nextBefore: null }) })
  })
  await page.route(`${roomPath}/events*`, (route) =>
    route.fulfill({ json: success({ items: [], cursor: '0', resetRequired: false, activeRuns: [] }) }),
  )
  await page.route(`${roomPath}/tasks*`, (route) => route.fulfill({ json: success({ items: [], nextCursor: null }) }))

  const isMobile = testInfo.project.name === 'mobile'
  await page.goto('/collaboration')
  await expect(page.getByRole('status', { name: '会话消息加载中' })).toBeVisible()
  await expect(page.locator('.skeleton-grid')).toHaveCount(0)
  await expect(page.getByText('正在加载会话…')).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('collaboration-loading-session.png') })

  auth.resolve()
  await expect(page.getByRole('link', { name: '协作首页', includeHidden: true })).toBeAttached()
  await expect(page.getByRole('status', { name: '会话消息加载中' })).toBeVisible()
  await expect(page.locator('.skeleton-grid')).toHaveCount(0)

  teams.resolve()
  await expect(page.getByRole('heading', { name: '协作', exact: true })).toBeAttached({ timeout: 15_000 })
  const openList = page.getByRole('button', { name: '打开会话列表' })
  if (isMobile) await openList.click()
  const sidebar = page.getByRole('complementary', { name: '会话列表' })
  await expect(sidebar.getByRole('status', { name: '会话列表加载中' })).toBeVisible()
  expect(await sidebar.evaluate((element) => element.scrollWidth - element.clientWidth)).toBe(0)
  await page.screenshot({ path: testInfo.outputPath('collaboration-loading-list.png') })
  if (isMobile) {
    await page.keyboard.press('Escape')
    await expect(openList).toBeFocused()
  }

  list.resolve()
  await expect(page).toHaveURL(new RegExp(`/collaboration/${room.id}$`))
  await expect(page.getByRole('status', { name: '会话消息加载中' })).toBeVisible()
  const header = page.locator('.dsh-chat-header')
  const pendingHeader = await header.boundingBox()
  detail.resolve()
  const input = page.getByRole('textbox', { name: '协作消息' })
  const loading = page.getByRole('status', { name: '会话消息加载中' })
  await expect(input).toBeVisible()
  await expect(loading).toBeVisible()
  await expect(page.getByText('正在加载消息…')).toHaveCount(0)
  const loadedHeader = await header.boundingBox()
  expect(Math.abs((loadedHeader?.height ?? 0) - (pendingHeader?.height ?? 0))).toBeLessThanOrEqual(8)
  const skeletonItem = loading.locator('.react-loading-skeleton').first()
  await expect(skeletonItem).toBeVisible()
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const animationName = await skeletonItem.evaluate((element) => getComputedStyle(element, '::after').animationName)
  expect(animationName).toBe('none')
  if (isMobile) await page.locator('.workspace-shell').evaluate((element) => element.classList.add('dark'))
  await page.screenshot({ path: testInfo.outputPath('collaboration-loading-messages.png') })

  const before = await input.boundingBox()
  messages.resolve()
  await expect(loading).toHaveCount(0)
  await expect(input).toBeVisible()
  expect(await input.boundingBox()).toEqual(before)
})
