import { expect, test } from '@playwright/test'
import { VISUAL_IDS } from './fixtures'
import { installApiMocks } from './mock-api'

function success(data: unknown) {
  return { success: true, code: 'OK', message: 'OK', requestId: 'bot-memory-visual-test', data }
}

test('[desktop] [mobile] 筛选长期记忆并局部修改常驻状态', async ({ page }, testInfo) => {
  await installApiMocks(page)
  const { teamId, userId } = VISUAL_IDS
  const stamp = '2026-11-17T08:00:00.000Z'
  const botId = 'da55aa00-0000-4000-8000-000000000061'
  const memoryId = 'da55aa00-0000-4000-8000-000000000062'
  const bot = {
    id: botId,
    name: '交付助理',
    teamId,
    responsibility: '协助团队交付',
    ownerUserId: userId,
    ownerName: '负责人',
    instructions: '',
    configVersion: 1,
    status: 'enabled',
    availability: 'available',
    avatarKey: null,
    modelConnectionId: null,
    modelId: null,
    connectionName: null,
    skillIds: [],
    lastActiveAt: null,
    updatedAt: stamp,
  }
  const memory = {
    id: memoryId,
    botId,
    botName: bot.name,
    scope: 'user',
    content: '发布确认时用中文简述',
    essential: false,
    sourceUserName: '负责人',
    sourceConversationId: null,
    sourceConversationName: null,
    updatedAt: stamp,
    canEdit: true,
    canRemove: true,
  }
  const root = `**/api/v1/teams/${teamId}`
  await page.route(`${root}/bots*`, (route) => route.fulfill({ json: success({ items: [bot], nextCursor: null }) }))
  await page.route(`${root}/bot-memories*`, (route) => {
    const scope = new URL(route.request().url()).searchParams.get('scope')
    return route.fulfill({ json: success({ items: scope === 'bot' ? [] : [memory], nextCursor: null }) })
  })
  await page.route(`**/api/v1/bot-memories/${memoryId}/update`, (route) => {
    expect(route.request().postDataJSON()).toEqual({ essential: true })
    memory.essential = true
    return route.fulfill({ json: success(memory) })
  })

  await page.goto('/capabilities/memory')
  const visibleMemory = page.getByRole('article').filter({ hasText: memory.content })
  await expect(visibleMemory).toBeVisible()
  await expect(visibleMemory.getByText('来源成员 负责人')).toBeVisible()
  const filter = page.getByRole('combobox', { name: '筛选记忆范围' })
  await filter.selectOption('bot')
  await expect(page.getByText('没有匹配的记忆')).toBeVisible()
  await filter.selectOption('user')
  const edit = visibleMemory.getByRole('button', { name: '编辑' })
  await edit.click()
  await expect(page.getByRole('dialog', { name: '编辑记忆' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(edit).toBeFocused()
  await edit.click()
  await page.getByRole('checkbox', { name: '常驻记忆' }).check()
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect(visibleMemory.getByText('常驻', { exact: true })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('bot-memory.png') })
})
