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
