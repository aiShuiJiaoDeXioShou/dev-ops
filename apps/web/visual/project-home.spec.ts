import { expect, test } from '@playwright/test'
import { VISUAL_IDS } from './fixtures'
import { installApiMocks } from './mock-api'

const coreRepository = '3562d4d3-dbef-4d82-9134-a9e5c90bf576'
const repositories = [
  { id: coreRepository, namespace: 'team', name: 'core', providerKey: 'github', connectionName: '团队 GitHub' },
]
const projects = Array.from({ length: 16 }, (_, index) => ({
  id: `40ef95a1-522d-4bfa-8cd3-${String(index + 1).padStart(12, '0')}`,
  teamId: VISUAL_IDS.teamId,
  name: `项目 ${index + 1}`,
  description: '项目说明',
  owner: { userId: VISUAL_IDS.userId, name: '管理员', status: 'active', available: true },
  status: index < 8 ? 'active' : 'paused',
  counts: { openRequirements: index + 1, openBugs: 1 },
  version: 1,
  createdAt: '2026-11-11T03:52:27.291Z',
  updatedAt: '2026-11-11T03:58:42.193Z',
}))

test('[desktop] [mobile] 首页按仓库筛选、保留 URL 并显示紧凑项目卡片', async ({ page }, testInfo) => {
  const teamPath = `/api/v1/teams/${VISUAL_IDS.teamId}`
  const envelope = (data: unknown) => ({ success: true, code: 'OK', message: 'OK', requestId: 'home-visual', data })
  await installApiMocks(page)
  await page.route(`**${teamPath}/project-repositories?*`, (route) =>
    route.fulfill({ json: envelope({ items: repositories, total: repositories.length, page: 1, pageSize: 100 }) }),
  )
  await page.route(`**${teamPath}/projects?*`, (route) => {
    const params = new URL(route.request().url()).searchParams
    const page = Number(params.get('page') ?? '1')
    const pageSize = Number(params.get('pageSize') ?? '20')
    const status = params.get('status')
    const repo = params.get('repositoryId')
    const matches = projects.filter((project, index) => (!status || project.status === status) && (!repo || index < 2))
    return route.fulfill({
      json: envelope({
        items: matches.slice((page - 1) * pageSize, page * pageSize),
        total: matches.length,
        page,
        pageSize,
      }),
    })
  })

  await page.goto('/projects?page=2&pageSize=8')
  const cards = page.locator('.project-card')
  const filter = page.getByRole('combobox', { name: '按仓库筛选' })
  await expect(cards).toHaveCount(8)
  await expect(filter).toBeEnabled()
  const desktop = testInfo.project.name === 'desktop'
  const columns = await page
    .locator('.project-grid')
    .evaluate((element) => getComputedStyle(element).gridTemplateColumns)
  expect(columns.split(' ')).toHaveLength(desktop ? 4 : 1)
  expect((await cards.first().boundingBox())?.height ?? Infinity).toBeLessThan(190)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBeTruthy()
  await page.screenshot({ path: testInfo.outputPath('projects-compact.png') })

  await filter.click()
  await page.getByRole('textbox', { name: '搜索仓库' }).fill('core')
  const activityRequest = page.waitForRequest((request) => {
    const url = new URL(request.url())
    return url.pathname === `${teamPath}/project-activity` && url.searchParams.get('repositoryId') === coreRepository
  })
  await page.getByRole('option', { name: 'team/core · 团队 GitHub' }).click()
  await activityRequest
  await expect(cards).toHaveCount(2)
  expect(new URL(page.url()).searchParams.get('repositoryId')).toBe(coreRepository)
  expect(new URL(page.url()).searchParams.has('page')).toBeFalsy()

  await page.reload()
  await expect(filter).toHaveText('team/core · 团队 GitHub')
  await expect(cards).toHaveCount(2)
  await page.getByRole('combobox', { name: '项目状态' }).selectOption('paused')
  await expect(page.getByText('没有匹配的项目', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '清除筛选' }).click()
  await expect(filter).toHaveText('全部仓库')
  await expect(cards).toHaveCount(projects.length)
})
