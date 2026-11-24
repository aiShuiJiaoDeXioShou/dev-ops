import { expect, test } from '@playwright/test'
import { VISUAL_IDS } from './fixtures'
import { installApiMocks } from './mock-api'

function success(data: unknown) {
  return { success: true, code: 'OK', message: 'OK', requestId: 'bot-inbox-visual-test', data }
}

test('[desktop] [mobile] 等你回复汇总可重试并打开会话继续沟通', async ({ page }, testInfo) => {
  await installApiMocks(page)
  const { teamId, userId } = VISUAL_IDS
  const stamp = '2026-11-17T08:00:00.000Z'
  const roomId = 'da55aa00-0000-4000-8000-000000000041'
  const botId = 'da55aa00-0000-4000-8000-000000000042'
  const room = {
    id: roomId,
    teamId,
    kind: 'direct',
    name: '交付核对会话',
    leaderBotId: null,
    lastMessageAt: stamp,
    responsibility: '',
    instructions: '',
    tags: [],
    botSettings: [],
    skillReferences: [],
    todos: [],
    members: [
      { id: userId, name: '负责人', kind: 'user' },
      { id: botId, name: '交付助理', kind: 'bot' },
    ],
  }
  let failed = true
  let replied = false
  await page.route(`**/api/v1/teams/${teamId}/bot-inbox`, (route) => {
    if (failed)
      return route.fulfill({
        json: { success: false, code: 'INTERNAL_ERROR', message: '暂时不可用', requestId: 'inbox' },
      })
    return route.fulfill({
      json: success(
        replied
          ? { items: [], count: 0 }
          : {
              count: 1,
              items: [
                {
                  id: roomId,
                  conversationId: roomId,
                  conversationName: room.name,
                  updatedAt: stamp,
                  reason: 'awaiting_reply',
                },
              ],
            },
      ),
    })
  })
  await page.route(`**/api/v1/teams/${teamId}/bot-conversations*`, (route) =>
    route.fulfill({
      json: success({
        items: [
          {
            ...room,
            workStatus: replied ? 'completed' : 'awaiting_reply',
            botAvatars: [],
            lastMessagePreview: '请确认目标环境',
          },
        ],
        nextCursor: null,
      }),
    }),
  )
  const path = `**/api/v1/bot-conversations/${roomId}`
  await page.route(path, (route) => route.fulfill({ json: success(room) }))
  await page.route(`${path}/messages*`, (route) => {
    const message = {
      id: 'da55aa00-0000-4000-8000-000000000043',
      sequence: '1',
      speakerKind: 'bot',
      speakerId: botId,
      speakerName: '交付助理',
      createdAt: stamp,
      runId: null,
      body: { blocks: [{ type: 'text', text: '请确认目标环境' }] },
    }
    if (route.request().method() === 'GET')
      return route.fulfill({ json: success({ items: [message], nextBefore: null }) })
    expect(route.request().postDataJSON().text).toBe('使用测试环境')
    replied = true
    return route.fulfill({ json: success({ message, runId: null, delivery: 'queued' }) })
  })
  await page.goto('/collaboration?view=inbox')
  await expect(page.getByText('会话汇总加载失败')).toBeVisible()
  failed = false
  await page.getByRole('button', { name: '重新检查', exact: true }).click()
  const link = page.getByRole('link', { name: /交付核对会话/ })
  await expect(link).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('bot-inbox-awaiting-reply.png') })
  await link.press('Enter')
  await expect(page.getByRole('complementary', { name: '任务面板' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '验收通过' })).toHaveCount(0)
  await expect(page.locator('.dsh-messages').getByText('请确认目标环境')).toBeVisible()
  const composer = page.getByRole('textbox', { name: '协作消息' })
  await composer.fill('使用测试环境')
  await composer.press('Enter')
  await expect(composer).toHaveValue('')
  await page.goto('/collaboration?view=inbox')
  await expect(page.getByText('暂无等待回复的会话', { exact: true })).toBeVisible()
})
