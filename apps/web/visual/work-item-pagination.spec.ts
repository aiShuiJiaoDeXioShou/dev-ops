import { expect, test } from '@playwright/test'
import { apiFixtures, VISUAL_IDS } from './fixtures'
import { installApiMocks } from './mock-api'

function readListFixture(endpoint: string) {
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
    throw new Error(`缺少列表夹具：${endpoint}`)
  }
  const items: unknown[] = fixture.data.items
  return { fixture, items }
}

for (const [resource, label] of [
  ['requirements', '需求'],
  ['bugs', 'Bug'],
]) {
  test(`[desktop] [mobile] ${label}只在有多页结果时显示分页`, async ({ page }, testInfo) => {
    const path = `/projects/${VISUAL_IDS.projectId}/${resource}`
    const endpoint = `/api/v1${path}`
    const { fixture, items } = readListFixture(endpoint)
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

const teamPath = `/api/v1/teams/${VISUAL_IDS.teamId}`
const projectPath = `/projects/${VISUAL_IDS.projectId}`

for (const { label, path, endpoint, itemSelector, idKey } of [
  {
    label: '项目',
    path: '/projects',
    endpoint: `${teamPath}/projects`,
    itemSelector: '.project-card',
    idKey: 'id',
  },
  {
    label: '流水线运行历史',
    path: `${projectPath}/pipelines?tab=runs`,
    endpoint: `/api/v1${projectPath}/pipeline-runs`,
    itemSelector: 'tbody tr',
    idKey: 'runId',
  },
]) {
  test(`[desktop] [mobile] ${label}只在有多页结果时显示分页`, async ({ page }, testInfo) => {
    const { fixture, items } = readListFixture(endpoint)
    const item = items[0]
    if (!item || typeof item !== 'object') throw new Error(`列表夹具缺少条目：${endpoint}`)

    const pageSize = 20
    const records = Array.from({ length: pageSize + 1 }, (_, index) => ({
      ...item,
      [idKey]: `748ec1f4-fa7a-48a4-b809-${String(index).padStart(12, '0')}`,
    }))
    let total = 1
    await installApiMocks(page)
    await page.route(
      (url) => url.pathname === endpoint,
      (route) => {
        const currentPage = Number(new URL(route.request().url()).searchParams.get('page') ?? 1)
        const start = (currentPage - 1) * pageSize
        return route.fulfill({
          json: {
            ...fixture,
            data: {
              items: records.slice(start, Math.min(start + pageSize, total)),
              total,
              page: currentPage,
              pageSize,
            },
          },
        })
      },
    )

    const rows = page.locator(itemSelector)
    await page.goto(path)
    await expect(rows).toHaveCount(1)
    await expect(page.locator('.pagination')).toHaveCount(0)
    await expect(page.getByText('共 1 条', { exact: true })).toHaveCount(0)
    await page.screenshot({ path: testInfo.outputPath('single-page.png') })

    total = pageSize
    await page.reload()
    await expect(rows).toHaveCount(pageSize)
    await expect(page.locator('.pagination')).toHaveCount(0)
    await expect(page.getByText(`共 ${total} 条`, { exact: true })).toHaveCount(0)

    total = pageSize + 1
    await page.reload()
    await expect(rows).toHaveCount(pageSize)
    const next = page.getByRole('button', { name: '下一页' })
    const previous = page.getByRole('button', { name: '上一页' })
    await expect(previous).toBeDisabled()
    await next.click()
    await expect(next).toBeDisabled()
    await expect(rows).toHaveCount(1)
    const currentUrl = new URL(page.url())
    expect(currentUrl.searchParams.get('page')).toBe('2')
    for (const [name, value] of new URL(path, currentUrl).searchParams) {
      expect(currentUrl.searchParams.get(name)).toBe(value)
    }
    await previous.click()
    await expect(rows).toHaveCount(pageSize)
    await expect(previous).toBeDisabled()
  })
}
