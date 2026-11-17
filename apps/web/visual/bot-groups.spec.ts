import { expect, test } from '@playwright/test'
import { VISUAL_IDS } from './fixtures'
import { installApiMocks } from './mock-api'

function success(data: unknown) {
  return { success: true, code: 'OK', message: 'OK', requestId: 'bot-group-visual-test', data }
}

test('[desktop] [mobile] 建立群组并切换设置与任务面板', async ({ page }, testInfo) => {
  await installApiMocks(page)
  const { teamId, userId } = VISUAL_IDS
  await page.route(`**/api/v1/teams/${teamId}/work-tags*`, (route) =>
    route.fulfill({ json: success({ items: [], nextCursor: null }) }),
  )
  const stamp = '2026-11-17T08:00:00.000Z'
  const roomId = 'da55aa00-0000-4000-8000-000000000051'
  const leaderId = 'da55aa00-0000-4000-8000-000000000052'
  const helperId = 'da55aa00-0000-4000-8000-000000000053'
  const bots = [
    { id: leaderId, name: '交付助理' },
    { id: helperId, name: '复核助理' },
  ].map((item) => ({
    ...item,
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
  }))
  const room = {
    id: roomId,
    teamId,
    kind: 'group',
    name: '交付群组',
    leaderBotId: leaderId,
    lastMessageAt: stamp,
    responsibility: '',
    instructions: '',
    tags: [],
    members: [{ id: userId, name: '负责人', kind: 'user' }, ...bots.map(({ id, name }) => ({ id, name, kind: 'bot' }))],
  }
  const routeBase = `**/api/v1/teams/${teamId}`
  const roomPath = `**/api/v1/bot-conversations/${roomId}`
  let created = false
  await page.route(`${routeBase}/bots*`, (route) => route.fulfill({ json: success({ items: bots, nextCursor: null }) }))
  await page.route(`${routeBase}/members`, (route) => route.fulfill({ json: success([]) }))
  await page.route(`${routeBase}/bot-inbox`, (route) => route.fulfill({ json: success({ items: [], count: 0 }) }))
  await page.route(`${routeBase}/bot-conversations*`, (route) => {
    if (route.request().method() !== 'POST')
      return route.fulfill({ json: success({ items: created ? [room] : [], nextCursor: null }) })
    expect(route.request().postDataJSON()).toMatchObject({
      kind: 'group',
      name: '交付群组',
      leaderBotId: leaderId,
      botIds: [leaderId, helperId],
    })
    created = true
    return route.fulfill({ json: success(room) })
  })
  await page.route(roomPath, (route) => route.fulfill({ json: success(room) }))
  await page.route(`${roomPath}/messages*`, (route) =>
    route.fulfill({ json: success({ items: [], nextBefore: null }) }),
  )
  await page.route(`${roomPath}/events*`, (route) =>
    route.fulfill({ json: success({ items: [], activeRuns: [], cursor: '0', resetRequired: false }) }),
  )
  await page.route(`${roomPath}/tasks*`, (route) => route.fulfill({ json: success({ items: [], nextCursor: null }) }))

  await page.goto('/collaboration')
  if (testInfo.project.name === 'mobile') await page.getByRole('button', { name: '打开会话列表' }).click()
  await page.getByRole('button', { name: '新建群组' }).click()
  const dialog = page.getByRole('dialog', { name: '新建群组' })
  await dialog.getByLabel('群组名称').fill('交付群组')
  await dialog.getByRole('checkbox', { name: '交付助理' }).check()
  await dialog.getByRole('checkbox', { name: '复核助理' }).check()
  await dialog.getByRole('button', { name: '创建群组' }).click()
  await expect(page.getByText('智能体读取团队资料后，结果对会话全体成员可见。')).toBeVisible()
  const settings = page.getByRole('button', { name: '会话设置' })
  await settings.click()
  const panel = page.getByRole('complementary', { name: '会话设置' })
  await expect(panel.getByRole('combobox', { name: 'Leader' })).toHaveValue(leaderId)
  await page.screenshot({ path: testInfo.outputPath('bot-group-settings.png') })
  await page.keyboard.press('Escape')
  await expect(settings).toBeFocused()
  await expect(panel).toBeHidden()
  await page.getByRole('button', { name: '任务列表' }).click()
  await expect(page.getByRole('complementary', { name: '任务面板' })).toBeVisible()
  await expect(panel).toBeHidden()
})
