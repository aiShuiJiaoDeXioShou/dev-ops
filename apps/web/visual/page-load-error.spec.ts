import { expect, test } from '@playwright/test'
import { VISUAL_IDS } from './fixtures'
import { installApiMocks } from './mock-api'

const teamPath = `/api/v1/teams/${VISUAL_IDS.teamId}`
const cases = [
  {
    path: '/projects',
    endpoint: `${teamPath}/projects`,
    title: '项目列表加载失败',
    retryLabel: '重新加载',
    heading: '项目',
  },
]

for (const { path, endpoint, title, retryLabel, heading } of cases) {
  test(`[desktop] [mobile] ${title}时显示 Bot，可重试恢复`, async ({ page }, testInfo) => {
    await installApiMocks(page)
    let unavailable = true
    await page.route(
      (url) => url.pathname === endpoint,
      (route) =>
        unavailable
          ? route.fulfill({ status: 500, headers: { 'X-Request-Id': 'req-visual-500' }, json: {} })
          : route.fallback(),
    )

    await page.goto(path)
    const failure = page.getByRole('alert').filter({ hasText: title })
    await expect(failure.getByRole('heading', { name: title })).toBeVisible({ timeout: 15_000 })
    await expect(failure.locator('img[src$="bot-signal-live.svg"]')).toBeVisible()
    await expect(failure).toContainText('HTTP 500')
    await expect(failure).toContainText('请求标识：req-visual-500')
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      page.viewportSize()?.width ?? 0,
    )
    await page.screenshot({ path: testInfo.outputPath('load-error.png') })

    unavailable = false
    await failure.getByRole('button', { name: retryLabel }).click()
    await expect(page.getByRole('heading', { name: heading, exact: true, level: 1 })).toBeVisible()
    await expect(failure).toHaveCount(0)
  })
}

test('[desktop] [mobile] 会话列表首次加载失败时在主区重试，成功后显示真实空状态', async ({ page }, testInfo) => {
  await installApiMocks(page)
  let unavailable = true
  await page.route(
    (url) => url.pathname === `${teamPath}/bot-conversations`,
    (route) =>
      unavailable
        ? route.fulfill({ status: 500, headers: { 'X-Request-Id': 'req-collaboration-500' }, json: {} })
        : route.fulfill({
            json: {
              success: true,
              code: 'OK',
              message: 'OK',
              requestId: 'req-recovered',
              data: { items: [], nextCursor: null },
            },
          }),
  )

  await page.goto('/collaboration')
  const content = page.locator('.conversation-main')
  const failure = content.getByRole('alert').filter({ hasText: '会话列表加载失败' })
  await expect(failure).toContainText('请求标识：req-collaboration-500', { timeout: 15_000 })
  await expect(page.getByRole('heading', { name: '选择会话' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '重新检查' })).toHaveCount(1)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    page.viewportSize()?.width ?? 0,
  )
  await page.screenshot({ path: testInfo.outputPath('collaboration-load-error.png'), animations: 'disabled' })

  unavailable = false
  await failure.getByRole('button', { name: '重新检查' }).press('Enter')
  await expect(content.getByRole('heading', { name: '还没有会话' })).toBeVisible()
  await expect(content.getByRole('link', { name: '查看智能体' })).toHaveAttribute('href', '/capabilities/bots')
  await expect(failure).toHaveCount(0)
})
