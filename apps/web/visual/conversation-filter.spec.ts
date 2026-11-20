import { expect, test } from '@playwright/test'
import { VISUAL_IDS } from './fixtures'
import { installApiMocks } from './mock-api'

const tagId = 'da55aa00-0000-4000-8000-000000000090'
const roomId = 'da55aa00-0000-4000-8000-000000000012'
const botId = 'da55aa00-0000-4000-8000-000000000011'

function envelope(data: unknown) {
  return { success: true, code: 'OK', message: 'ok', requestId: 'visual-request', data }
}

test('[desktop] [mobile] 会话筛选只在应用后生效并复用首页漏斗图标', async ({ page }, testInfo) => {
  await installApiMocks(page)
  const { teamId, userId } = VISUAL_IDS
  const stamp = '2026-11-17T08:00:00.000Z'
  await page.route(`**/api/v1/teams/${teamId}/bot-inbox`, (route) =>
    route.fulfill({ json: envelope({ items: [], count: 0 }) }),
  )
  await page.route(`**/api/v1/teams/${teamId}/work-tags*`, (route) =>
    route.fulfill({
      json: envelope({ items: [{ id: tagId, name: '交付', updatedAt: stamp }], nextCursor: null }),
    }),
  )
  const appliedTags: string[] = []
  await page.route(`**/api/v1/teams/${teamId}/bot-conversations*`, (route) => {
    const requestedTag = new URL(route.request().url()).searchParams.get('tagId') ?? ''
    appliedTags.push(requestedTag)
    return route.fulfill({
      json: envelope({
        items: requestedTag
          ? []
          : [
              {
                id: roomId,
                teamId,
                name: '验收助理',
                kind: 'direct',
                leaderBotId: null,
                lastMessageAt: stamp,
                responsibility: '',
                instructions: '',
                tags: [],
                skillReferences: [],
                members: [
                  { id: botId, name: '验收助理', kind: 'bot' },
                  { id: userId, name: '负责人', kind: 'user' },
                ],
                botAvatars: [{ id: botId, avatarKey: null, enabled: true }],
                lastMessagePreview: '查看今天的验收结果',
              },
            ],
        nextCursor: null,
      }),
    })
  })

  await page.goto('/collaboration?view=inbox')
  if (testInfo.project.name === 'mobile') await page.getByRole('button', { name: '打开会话列表' }).click()
  const trigger = page.getByRole('button', { name: '会话筛选' })
  await expect(page.locator('.conversation-item').filter({ hasText: '验收助理' })).toBeVisible()
  // 入口与新建一致，只保留一个图标，不占文字宽度。
  await expect(trigger).toHaveText('')
  await expect(trigger.locator('svg')).toHaveCount(1)

  // 关闭面板丢弃未应用条件，列表仍展示全部会话。
  await trigger.press('Enter')
  const panel = page.getByRole('dialog', { name: '会话筛选' })
  const tag = panel.getByRole('combobox', { name: '工作标签' })
  await expect(panel).toBeFocused()
  await expect(tag).toHaveValue('')
  await page.screenshot({ path: testInfo.outputPath('conversation-filter-panel.png') })
  await page.keyboard.press('Tab')
  await expect(tag).toBeFocused()
  await tag.selectOption(tagId)
  await page.keyboard.press('Escape')
  await expect(panel).toBeHidden()
  await expect(page.getByRole('button', { name: '会话筛选' })).toBeFocused()
  await expect(page.locator('.conversation-item').filter({ hasText: '验收助理' })).toBeVisible()

  // 应用后按标签请求会话，触发器说明已应用条件数。
  await trigger.click()
  await expect(panel).toBeFocused()
  await expect(tag).toHaveValue('')
  await tag.selectOption(tagId)
  await panel.getByRole('button', { name: '应用筛选' }).click()
  await expect(page.getByRole('button', { name: '会话筛选，已应用 1 个条件' })).toBeVisible()
  await expect(page.getByText('没有匹配的会话')).toBeVisible()
  await expect.poll(() => appliedTags.at(-1)).toBe(tagId)

  await page.screenshot({ path: testInfo.outputPath('conversation-filter-applied.png') })

  // 无匹配时就地清除筛选，焦点回到筛选入口。
  await page.getByRole('button', { name: '清除筛选' }).click()
  await expect(page.getByRole('button', { name: '会话筛选' })).toBeFocused()
  await expect(page.locator('.conversation-item').filter({ hasText: '验收助理' })).toBeVisible()

  // 重置并再次应用也恢复全部会话。
  await page.getByRole('button', { name: '会话筛选', exact: true }).click()
  await tag.selectOption(tagId)
  await panel.getByRole('button', { name: '应用筛选' }).click()
  await page.getByRole('button', { name: '会话筛选，已应用 1 个条件' }).click()
  await panel.getByRole('button', { name: '重置' }).click()
  await panel.getByRole('button', { name: '应用筛选' }).click()
  await expect(page.getByRole('button', { name: '会话筛选' })).toBeVisible()
  await expect(page.locator('.conversation-item').filter({ hasText: '验收助理' })).toBeVisible()

  // 从面板进入标签管理时焦点交给弹窗，不被浮层的关闭逻辑抢回列表。
  await page.getByRole('button', { name: '会话筛选' }).click()
  await panel.getByRole('button', { name: '管理标签' }).click()
  const manager = page.getByRole('dialog', { name: '工作标签' })
  await expect(manager).toBeVisible()
  await expect(manager.getByRole('textbox', { name: '新标签名称' })).toBeFocused()
})
