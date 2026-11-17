import { expect, test } from '@playwright/test'
import type { ApiSuccessData } from '@dev-ops/api-client'
import { apiFixtures, VISUAL_IDS } from './fixtures'
import { installApiMocks } from './mock-api'

type BotView = ApiSuccessData<'/api/v1/bots/{botId}', 'get'>

function success(data: unknown) {
  return { success: true, code: 'OK', message: 'OK', requestId: 'bot-visual-test', data }
}

test('[desktop] [mobile] 智能体目录创建、刷新、详情和停用', async ({ page }, testInfo) => {
  await installApiMocks(page)
  const { teamId, userId } = VISUAL_IDS
  const fixtureId = 'da55aa00-0000-4000-8000-000000000011'
  const fixture: BotView = {
    id: fixtureId,
    teamId,
    name: '验收助理',
    responsibility: '对照验收条件检查交付结果',
    instructions: '简要列出证据与待处理问题',
    ownerName: '负责人',
    ownerUserId: userId,
    avatarKey: null,
    configVersion: 1,
    status: 'enabled',
    availability: 'model_unbound',
    connectionName: null,
    modelConnectionId: null,
    modelId: null,
    skillIds: [],
    updatedAt: '2026-11-17T08:00:00.000Z',
    lastActiveAt: null,
  }
  let exists = false
  let writes = 0
  await page.route(`**/api/v1/teams/${teamId}/members`, (route) =>
    route.fulfill({
      json: success([
        {
          userId,
          name: '负责人',
          email: 'fixture@example.test',
          role: 'admin',
          status: 'active',
          joinedAt: '2026-11-17T08:00:00.000Z',
        },
      ]),
    }),
  )
  await page.route(`**/api/v1/teams/${teamId}/bots*`, async (route) => {
    if (route.request().method() === 'POST') {
      expect(route.request().postDataJSON()).toMatchObject({
        name: fixture.name,
        responsibility: fixture.responsibility,
      })
      exists = true
      writes++
      return route.fulfill({ json: success(fixture) })
    }
    const term = new URL(route.request().url()).searchParams.get('query')
    const items = exists && (!term || fixture.name.includes(term)) ? [fixture] : []
    return route.fulfill({ json: success({ items, nextCursor: null }) })
  })
  await page.route(`**/api/v1/bots/${fixtureId}`, (route) => route.fulfill({ json: success(fixture) }))
  await page.route(`**/api/v1/bots/${fixtureId}/runs*`, (route) =>
    route.fulfill({ json: success({ items: [], nextCursor: null }) }),
  )
  await page.route(`**/api/v1/bots/${fixtureId}/disable`, (route) => {
    expect(route.request().postDataJSON()).toEqual({ configVersion: 1 })
    fixture.status = 'disabled'
    fixture.availability = 'disabled'
    fixture.configVersion = 2
    return route.fulfill({ json: success(fixture) })
  })

  await page.goto('/capabilities/bots')
  await expect(page.getByRole('tab', { name: '全部智能体' })).toBeVisible()
  const create = page.getByRole('button', { name: '创建智能体' })
  await create.click()
  const form = page.getByRole('dialog', { name: '创建智能体' })
  await expect(form.getByLabel('名称', { exact: true })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(create).toBeFocused()
  await create.click()
  await form.getByLabel('名称', { exact: true }).fill(fixture.name)
  await form.getByLabel('职责', { exact: true }).fill(fixture.responsibility)
  await form.getByRole('button', { name: '创建智能体', exact: true }).click()
  await expect(page.getByRole('link', { name: `查看${fixture.name}详情` })).toBeVisible()
  expect(writes).toBe(1)
  await page.reload()
  await expect(page.getByRole('link', { name: `查看${fixture.name}详情` })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('bot-list.png') })

  const search = page.getByRole('textbox', { name: '搜索智能体' })
  await search.fill('无匹配')
  await expect(page.getByText('没有找到智能体')).toBeVisible()
  await page.getByRole('button', { name: '清除筛选' }).click()
  await page.getByRole('link', { name: `查看${fixture.name}详情` }).click()
  const detail = page.getByRole('complementary', { name: '智能体详情' })
  await expect(detail).toBeVisible()
  await expect(detail.getByRole('tab', { name: '运行记录' })).toBeVisible()
  await expect(detail.getByRole('tab', { name: '项目' })).toHaveCount(0)
  await expect(detail.getByText('未绑定模型').first()).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('bot-detail.png') })
  await page.getByRole('button', { name: '停用智能体' }).click()
  const alert = page.getByRole('alertdialog')
  await expect(alert.getByRole('button', { name: '取消' })).toBeFocused()
  await alert.getByRole('button', { name: '确认停用' }).click()
  await expect(detail.getByText('已停用', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)

  const teams = apiFixtures['/api/v1/me/teams']
  if (teams && 'data' in teams && teams.data && 'teams' in teams.data && Array.isArray(teams.data.teams)) {
    await page.route('**/api/v1/me/teams', (route) =>
      route.fulfill({
        json: success({
          ...teams.data,
          teams: teams.data.teams.map((team) => ({ ...team, role: 'viewer' })),
        }),
      }),
    )
    await page.reload()
    await expect(page.getByRole('heading', { name: fixture.name })).toBeVisible()
    await expect(page.getByRole('button', { name: '编辑配置' })).toHaveCount(0)
  }
})
