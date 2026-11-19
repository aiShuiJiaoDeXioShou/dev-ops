import type { ApiSuccessData } from '@dev-ops/api-client'
import { expect, test } from '@playwright/test'
import { VISUAL_IDS } from './fixtures'
import { installApiMocks } from './mock-api'

function success(data: unknown) {
  return { success: true, code: 'OK', message: 'OK', requestId: 'new-group-dialog', data }
}

test('[desktop] [mobile] 群组选人、切换 Leader 与固定提交栏', async ({ page }, testInfo) => {
  await installApiMocks(page)
  const { teamId, userId } = VISUAL_IDS
  const stamp = '2026-11-19T08:00:00.000Z'
  const roomId = 'da55aa00-0000-4000-8000-000000000041'
  const yangId = 'da55aa00-0000-4000-8000-000000000042'
  const linId = 'da55aa00-0000-4000-8000-000000000043'
  const offlineId = 'da55aa00-0000-4000-8000-000000000044'
  const developerId = 'd290b120-1130-569f-8eb4-3329234453f6'
  const bots = [
    { id: yangId, name: '小杨', responsibility: '产品经理', avatarKey: 'prism', availability: 'available' as const },
    {
      id: linId,
      name: '小林',
      responsibility: '服务器运维与部署验证',
      avatarKey: 'orbit',
      availability: 'available' as const,
    },
    {
      id: offlineId,
      name: '小周',
      responsibility: '测试',
      avatarKey: 'signal',
      availability: 'worker_offline' as const,
    },
  ].map((bot) => ({
    ...bot,
    teamId,
    instructions: '',
    ownerUserId: userId,
    ownerName: '管理员',
    status: 'enabled' as const,
    accessMode: 'sandbox' as const,
    configVersion: 1,
    modelConnectionId: null,
    connectionName: null,
    modelId: 'deepseek-flash',
    updatedAt: stamp,
    lastActiveAt: null,
    skillIds: [],
  })) satisfies ApiSuccessData<'/api/v1/bots/{botId}', 'get'>[]
  const room = {
    id: roomId,
    teamId,
    name: '版本验收',
    kind: 'group',
    leaderBotId: linId,
    lastMessageAt: stamp,
    responsibility: '',
    instructions: '',
    tags: [],
    botSettings: [],
    skillReferences: [],
    members: [
      { id: userId, name: '管理员', kind: 'user' },
      { id: developerId, name: '开发同学', kind: 'user' },
      ...bots.filter((bot) => bot.id !== offlineId).map(({ id, name }) => ({ id, name, kind: 'bot' as const })),
    ],
  } satisfies ApiSuccessData<'/api/v1/bot-conversations/{conversationId}', 'get'>
  const teamPath = `**/api/v1/teams/${teamId}`
  const roomPath = `**/api/v1/bot-conversations/${room.id}`
  await page.route(`${teamPath}/bots*`, (route) => route.fulfill({ json: success({ items: bots, nextCursor: null }) }))
  await page.route(`${teamPath}/bot-inbox`, (route) => route.fulfill({ json: success({ items: [], count: 0 }) }))
  await page.route(`${teamPath}/bot-conversations*`, (route) => {
    if (route.request().method() !== 'POST') return route.fulfill({ json: success({ items: [], nextCursor: null }) })
    expect(route.request().postDataJSON()).toEqual({
      kind: 'group',
      name: room.name,
      leaderBotId: linId,
      botIds: [yangId, linId],
      memberUserIds: [developerId],
    })
    return route.fulfill({ json: success(room) })
  })
  await page.route(roomPath, (route) => route.fulfill({ json: success(room) }))
  await page.route(`${roomPath}/messages*`, (route) =>
    route.fulfill({ json: success({ items: [], nextBefore: null }) }),
  )
  await page.route(`${roomPath}/tasks*`, (route) => route.fulfill({ json: success({ items: [], nextCursor: null }) }))
  await page.route(`${roomPath}/events*`, (route) =>
    route.fulfill({ json: success({ items: [], cursor: '0', resetRequired: false, activeRuns: [] }) }),
  )

  await page.goto('/collaboration')
  const isMobile = testInfo.project.name === 'mobile'
  if (isMobile) await page.getByRole('button', { name: '打开会话列表' }).click()
  const trigger = page.getByRole('button', { name: '新建会话' })
  const dialog = page.getByRole('dialog', { name: '新建群组' })
  const groupName = dialog.getByRole('textbox', { name: '群组名称' })
  const yangOption = dialog.getByRole('checkbox', { name: '小杨' })
  const linOption = dialog.getByRole('checkbox', { name: '小林' })
  const offlineOption = dialog.getByRole('checkbox', { name: '小周' })
  const yangLeader = dialog.getByRole('button', { name: '将小杨设为 Leader' })
  const linLeader = dialog.getByRole('button', { name: '将小林设为 Leader' })
  const currentLeader = dialog.getByRole('button', { name: /设为 Leader$/, pressed: true })
  const submit = dialog.getByRole('button', { name: '创建群组' })
  async function openDialog() {
    await trigger.press('Enter')
    await page.getByRole('menuitem', { name: '新建群组' }).press('Enter')
    await expect(groupName).toBeFocused()
  }

  await openDialog()
  await expect(dialog.getByRole('combobox', { name: 'Leader' })).toHaveCount(0)
  await expect(dialog.getByRole('button', { name: /设为 Leader$/ })).toHaveCount(0)
  await expect(submit).toBeDisabled()
  await page.keyboard.press('Escape')
  await expect(trigger).toBeFocused()
  await openDialog()

  await groupName.fill(room.name)
  await expect(linOption).toBeVisible()
  const yangBox = await yangOption.boundingBox()
  const linBox = await linOption.boundingBox()
  expect(linBox?.y).toBe(yangBox?.y)
  expect(linBox?.x).toBeGreaterThan(yangBox?.x ?? Infinity)
  await offlineOption.press('Space')
  await expect(offlineOption).toBeChecked()
  await expect(offlineOption).toContainText('环境离线')
  await expect(dialog.getByRole('button', { name: '将小周设为 Leader' })).toHaveCount(0)
  await expect(submit).toBeDisabled()
  await offlineOption.press('Space')

  await linOption.press('Space')
  await expect(linLeader).toHaveAttribute('aria-pressed', 'true')
  await yangOption.click()
  await expect(yangOption).toBeChecked()
  await expect(yangLeader).toHaveAttribute('aria-pressed', 'true')
  await linOption.press('Space')
  await linOption.press('Space')
  await linLeader.press('Enter')
  await expect(linLeader).toBeFocused()
  await expect(linLeader).toHaveText('Leader')
  await expect(currentLeader).toHaveAccessibleName('将小林设为 Leader')
  await expect(linOption).toBeChecked()
  await linOption.press('Space')
  await expect(linLeader).toHaveCount(0)
  await expect(currentLeader).toHaveAccessibleName('将小杨设为 Leader')
  await linOption.press('Space')
  await expect(currentLeader).toHaveAccessibleName('将小林设为 Leader')

  if (isMobile) {
    await expect(linOption.getByText('服务器运维与部署验证', { exact: true })).toBeVisible()
  } else {
    await linOption.locator('img').hover()
    await expect(page.getByRole('tooltip')).toContainText('服务器运维与部署验证')
  }

  await dialog.getByRole('checkbox', { name: '开发同学' }).click()
  await expect(dialog.getByRole('checkbox', { name: '开发同学' })).toBeChecked()
  await expect(dialog.getByRole('checkbox', { name: '管理员' })).toHaveCount(0)
  await expect(submit).toBeEnabled()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('new-group-dialog.png'), animations: 'disabled' })
  await page.evaluate(() => document.documentElement.classList.add('dark'))
  await dialog.screenshot({ path: testInfo.outputPath('new-group-dialog-dark.png'), animations: 'disabled' })
  await page.evaluate(() => document.documentElement.classList.remove('dark'))

  await page.setViewportSize({ width: isMobile ? 390 : 1440, height: 500 })
  await expect(submit).toBeInViewport({ ratio: 1 })
  await submit.press('Enter')
  await expect(page).toHaveURL(new RegExp(`/collaboration/${roomId}$`))
  await expect(dialog).toBeHidden()
  await expect(page.getByRole('button', { name: `${room.name}的会话设置` })).toBeVisible()
})
