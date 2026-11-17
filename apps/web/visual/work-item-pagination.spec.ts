import { expect, test } from '@playwright/test'
import { apiFixtures, VISUAL_IDS } from './fixtures'
import { installApiMocks } from './mock-api'

for (const [resource, label] of [
  ['requirements', '需求'],
  ['bugs', 'Bug'],
]) {
  test(`[desktop] [mobile] ${label}只在有多页结果时显示分页`, async ({ page }, testInfo) => {
    const path = `/projects/${VISUAL_IDS.projectId}/${resource}`
    const endpoint = `/api/v1${path}`
    const fixture = apiFixtures[endpoint]
    if (
      !fixture ||
      typeof fixture !== 'object' ||
      !('data' in fixture) ||
      !fixture.data ||
      typeof fixture.data !== 'object' ||
      !('items' in fixture.data) ||
      !Array.isArray(fixture.data.items)
    ) {
      throw new Error(`缺少 ${label} 列表夹具`)
    }
    const { items } = fixture.data
    const countText = `共 ${items.length} 条`
    await installApiMocks(page)
    await page.route(
      (url) => url.pathname === endpoint,
      (route) => {
        const { searchParams } = new URL(route.request().url())
        const currentPage = Number(searchParams.get('page') ?? 1)
        const pageSize = Number(searchParams.get('pageSize') ?? 20)
        const start = (currentPage - 1) * pageSize
        return route.fulfill({
          json: {
            ...fixture,
            data: { items: items.slice(start, start + pageSize), total: items.length, page: currentPage, pageSize },
          },
        })
      },
    )

    const rows = page.getByRole('table').getByRole('row')
    await page.goto(path)
    await expect(rows).toHaveCount(items.length + 1)
    await expect(page.getByText(countText, { exact: true })).toHaveCount(0)
    await page.screenshot({ path: testInfo.outputPath('single-page.png') })

    await page.goto(`${path}?pageSize=${items.length}`)
    await expect(rows).toHaveCount(items.length + 1)
    await expect(page.getByText(countText, { exact: true })).toHaveCount(0)

    await page.goto(`${path}?pageSize=${items.length - 1}`)
    await expect(page.getByText(countText, { exact: true })).toBeVisible()
    await page.getByRole('button', { name: '下一页' }).click()
    await expect(rows).toHaveCount(2)
    await expect(page.getByRole('button', { name: '下一页' })).toBeDisabled()
    await page.getByRole('button', { name: '上一页' }).click()
    await expect(rows).toHaveCount(items.length)
  })
}
