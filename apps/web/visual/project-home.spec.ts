import { expect, test } from '@playwright/test'
import { VISUAL_IDS } from './fixtures'
import { installApiMocks } from './mock-api'

const coreRepository = '3562d4d3-dbef-4d82-9134-a9e5c90bf576'
const developer = '3562d4d3-dbef-4d82-9134-a9e5c90bf577'
const repositories = [
  { id: coreRepository, namespace: 'team', name: 'core', providerKey: 'github', connectionName: '团队 GitHub' },
]
const projects = Array.from({ length: 16 }, (_, index) => ({
  id: `40ef95a1-522d-4bfa-8cd3-${String(index + 1).padStart(12, '0')}`,
  teamId: VISUAL_IDS.teamId,
  name: `项目 ${index + 1}`,
  description: '项目说明',
  owner:
    index % 2
      ? { userId: developer, name: '开发同学', status: 'active', available: true }
      : { userId: VISUAL_IDS.userId, name: '管理员', status: 'active', available: true },
  status: index < 8 ? 'active' : 'paused',
  counts: { openRequirements: index + 1, openBugs: 1 },
  version: 1,
  createdAt: '2026-11-11T03:52:27.291Z',
  updatedAt: '2026-11-11T03:58:42.193Z',
}))

test('[desktop] [mobile] 首页组合筛选、保留 URL 并显示紧凑项目卡片', async ({ page }, testInfo) => {
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
    const owner = params.get('ownerId')
    const hasRepository = params.get('hasRepository')
    const matches = projects.filter(
      (project, index) =>
        (!status || project.status === status) &&
        (!repo || index < 2) &&
        (!owner || project.owner.userId === owner) &&
        (hasRepository === null || (hasRepository === 'true') === index < 2),
    )
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
  const filter = page.getByRole('button', { name: /^筛选/ })
  const panel = page.getByRole('dialog', { name: '项目筛选' })
  const repository = panel.getByRole('combobox', { name: '仓库', exact: true })
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

  await filter.press('Enter')
  await expect(panel).toBeVisible()
  await panel.getByRole('combobox', { name: '状态', exact: true }).selectOption('active')
  await panel.getByRole('combobox', { name: '负责人' }).selectOption({ label: '我负责' })
  await page.screenshot({ path: testInfo.outputPath('project-filters.png') })
  await repository.click()
  await expect(page.getByRole('textbox', { name: '搜索仓库' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(panel).toBeVisible()
  await expect(repository).toBeFocused()
  await repository.click()
  await page.getByRole('textbox', { name: '搜索仓库' }).fill('core')
  await page.getByRole('option', { name: 'team/core · 团队 GitHub' }).click()
  expect(new URL(page.url()).searchParams.has('repositoryId')).toBeFalsy()
  const activityRequest = page.waitForRequest((request) => {
    const url = new URL(request.url())
    return (
      url.pathname === `${teamPath}/project-activity` &&
      url.searchParams.get('repositoryId') === coreRepository &&
      url.searchParams.get('ownerId') === VISUAL_IDS.userId &&
      url.searchParams.get('status') === 'active'
    )
  })
  await panel.getByRole('button', { name: '应用筛选' }).click()
  await activityRequest
  await expect(panel).toBeHidden()
  await expect(filter).toBeFocused()
  await expect(filter).toHaveAccessibleName('筛选，已应用 3 个条件')
  await expect(cards).toHaveCount(1)
  await expect(cards.first()).toContainText('项目 1')
  expect(new URL(page.url()).searchParams.get('repositoryId')).toBe(coreRepository)
  expect(new URL(page.url()).searchParams.has('page')).toBeFalsy()

  await page.reload()
  await expect(cards).toHaveCount(1)
  await filter.click()
  await expect(repository).toHaveText('team/core · 团队 GitHub')
  await panel.getByRole('combobox', { name: '状态', exact: true }).selectOption('paused')
  await panel.getByRole('button', { name: '应用筛选' }).click()
  await expect(page.getByText('没有匹配的项目', { exact: true })).toBeVisible()

  await filter.click()
  await panel.getByRole('button', { name: '重置' }).click()
  await repository.click()
  await page.getByRole('option', { name: '未关联仓库' }).click()
  await panel.getByRole('button', { name: '应用筛选' }).click()
  await expect(filter).toHaveAccessibleName('筛选，已应用 1 个条件')
  await expect(cards).toHaveCount(8)
  expect(new URL(page.url()).searchParams.get('hasRepository')).toBe('false')
  await expect(cards.first()).toContainText('项目 3')
})
