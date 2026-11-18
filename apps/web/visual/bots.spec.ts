import { expect, test } from '@playwright/test'
import type { ApiSuccessData } from '@dev-ops/api-client'
import { apiFixtures, VISUAL_IDS } from './fixtures'
import { installApiMocks } from './mock-api'

type BotView = ApiSuccessData<'/api/v1/bots/{botId}', 'get'>

function success(data: unknown) {
  return { success: true, code: 'OK', message: 'OK', requestId: 'bot-visual-test', data }
}

test('[desktop] [mobile] 智能体目录创建、打开私聊、刷新、详情和停用', async ({ page }, testInfo) => {
  await installApiMocks(page)
  const { teamId, userId } = VISUAL_IDS
  const fixtureId = 'da55aa00-0000-4000-8000-000000000011'
  const connectionId = 'da55aa00-0000-4000-8000-000000000013'
  const modelId = 'deepseek-flash'
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
    availability: 'available',
    connectionName: '团队 DeepSeek',
    modelConnectionId: connectionId,
    modelId,
    skillIds: [],
    updatedAt: '2026-11-17T08:00:00.000Z',
    lastActiveAt: null,
  }
  const room = {
    id: 'da55aa00-0000-4000-8000-000000000012',
    teamId,
    kind: 'direct',
    name: fixture.name,
    responsibility: '',
    instructions: '',
    leaderBotId: null,
    lastMessageAt: fixture.updatedAt,
    members: [
      { kind: 'bot', id: fixture.id, name: fixture.name, responsibility: fixture.responsibility },
      { kind: 'user', id: userId, name: '负责人' },
    ],
    tags: [],
    skillReferences: [],
  } satisfies ApiSuccessData<'/api/v1/bot-conversations/{conversationId}', 'get'>
  let exists = false
  let writes = 0
  let hasConversation = false
  await page.route(`**/api/v1/teams/${teamId}/bot-model-connections`, (route) =>
    route.fulfill({
      json: success([
        {
          id: connectionId,
          providerId: 'deepseek',
          name: fixture.connectionName,
          authType: 'api_key',
          status: 'active',
          disabledReason: null,
          loginUserName: null,
          version: 1,
          updatedAt: fixture.updatedAt,
        },
      ]),
    }),
  )
  await page.route(`**/api/v1/teams/${teamId}/bot-model-catalog*`, (route) =>
    route.fulfill({
      json: success([
        { providerId: 'deepseek', modelId, displayName: 'DeepSeek Flash', authTypes: ['api_key'], contextWindow: 8192 },
        {
          providerId: 'deepseek',
          modelId: 'fixture-oauth',
          displayName: '订阅模型',
          authTypes: ['oauth'],
          contextWindow: 8192,
        },
      ]),
    }),
  )
  await page.route(`**/api/v1/teams/${teamId}/bot-inbox`, (route) =>
    route.fulfill({ json: success({ items: [], count: 0 }) }),
  )
  await page.route(`**/api/v1/teams/${teamId}/bot-conversations*`, (route) => {
    if (route.request().method() === 'POST') {
      expect(route.request().postDataJSON()).toEqual({ kind: 'direct', botId: fixtureId })
      hasConversation = true
      return route.fulfill({ json: success(room) })
    }
    const item = { ...room, botAvatars: [{ id: fixtureId, avatarKey: null, enabled: true }], lastMessagePreview: null }
    return route.fulfill({ json: success({ items: hasConversation ? [item] : [], nextCursor: null }) })
  })
  const roomPath = `**/api/v1/bot-conversations/${room.id}`
  await page.route(roomPath, (route) => route.fulfill({ json: success(room) }))
  await page.route(`${roomPath}/messages*`, (route) =>
    route.fulfill({ json: success({ items: [], nextBefore: null }) }),
  )
  await page.route(`${roomPath}/events*`, (route) =>
    route.fulfill({ json: success({ items: [], cursor: '0', resetRequired: false, activeRuns: [] }) }),
  )
  await page.route(`${roomPath}/tasks*`, (route) => route.fulfill({ json: success({ items: [], nextCursor: null }) }))
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
        modelBinding: { connectionId, modelId },
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

  await page.goto('/collaboration')
  await expect(page.getByRole('heading', { name: '还没有会话' })).toBeVisible({ timeout: 15_000 })
  await page.getByRole('link', { name: '查看智能体' }).click()
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
  const submit = form.getByRole('button', { name: '创建智能体', exact: true })
  const connection = form.getByLabel('模型连接')
  const model = form.getByLabel('默认模型')
  await expect(model).toBeDisabled()
  await expect(submit).toBeEnabled()
  await connection.selectOption(connectionId)
  await expect(submit).toBeDisabled()
  await expect(model.getByRole('option', { name: '订阅模型' })).toHaveCount(0)
  await model.selectOption(modelId)
  await page.screenshot({ path: testInfo.outputPath('bot-create-model.png'), animations: 'disabled' })
  await submit.click()
  await expect(page.getByRole('link', { name: `查看${fixture.name}详情` })).toBeVisible()
  expect(writes).toBe(1)
  await page.getByRole('link', { name: `查看${fixture.name}详情` }).click()
  // 缓存中仍是刚离开的空列表，私聊成功后必须在下一次轮询前更新。
  await page.getByRole('button', { name: '打开对话' }).click()
  const chat = page.getByRole('tabpanel', { name: '对话' })
  const intro = chat.getByRole('heading', { name: fixture.name })
  const scroll = chat.locator('.dsh-chat-scroll')
  await expect(intro).toBeVisible()
  const messageArea = await scroll.boundingBox()
  const welcome = await chat.locator('.dsh-hero').boundingBox()
  const title = await intro.boundingBox()
  if (!messageArea || !welcome || !title) throw new Error('未找到空会话布局')
  expect(Math.abs(welcome.y + welcome.height / 2 - (messageArea.y + messageArea.height / 2))).toBeLessThan(2)
  expect(Math.abs(title.x + title.width / 2 - (messageArea.x + messageArea.width / 2))).toBeLessThan(2)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  if (testInfo.project.name === 'mobile') await page.getByRole('button', { name: '打开会话列表' }).click()
  const roomItem = page
    .getByRole('complementary', { name: '会话列表' })
    .getByRole('button', { name: `${fixture.name} 还没有消息` })
  await expect(roomItem).toHaveAttribute('aria-pressed', 'true', { timeout: 4000 })
  if (testInfo.project.name === 'mobile') await page.getByRole('button', { name: '收起会话列表' }).click()
  await page.screenshot({ path: testInfo.outputPath('bot-direct-empty.png'), animations: 'disabled' })
  await page.goBack()
  await page.goBack()
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
  await expect(detail.getByRole('tab', { name: '运行记录' })).toHaveCount(0)
  await expect(detail.getByRole('tab', { name: '项目' })).toHaveCount(0)
  await expect(detail.getByRole('definition').filter({ hasText: modelId })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('bot-detail.png') })
  await detail.getByRole('button', { name: '绑定模型' }).click()
  const modelForm = page.getByRole('dialog', { name: '绑定模型' })
  await expect(modelForm.getByRole('combobox', { name: '模型', exact: true })).toHaveValue(modelId)
  await modelForm.getByRole('button', { name: '取消' }).click()
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
