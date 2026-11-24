import { expect, test } from '@playwright/test'
import type { ApiSuccessData } from '@dev-ops/api-client'
import { VISUAL_IDS } from './fixtures'
import { installApiMocks } from './mock-api'

type Room = ApiSuccessData<'/api/v1/bot-conversations/{conversationId}', 'get'>
type Message = ApiSuccessData<'/api/v1/bot-conversations/{conversationId}/messages', 'get'>['items'][number]

function success(data: unknown) {
  return { success: true, code: 'OK', message: 'OK', requestId: 'conversation-content-test', data }
}

function failure() {
  return {
    success: false,
    code: 'ATTACHMENT_STORAGE_UNAVAILABLE',
    message: '附件储存暂不可用',
    requestId: 'conversation-content-test',
  }
}

test('[desktop] [mobile] 输入区随文字增高，附件可重试并随消息发送，回复显示 Markdown 层级', async ({
  page,
}, testInfo) => {
  await installApiMocks(page)
  const { teamId, userId } = VISUAL_IDS
  const stamp = '2026-11-17T08:00:00.000Z'
  const botId = 'da55aa00-0000-4000-8000-000000000011'
  const runId = 'da55aa00-0000-4000-8000-000000000020'
  const room: Room = {
    id: 'da55aa00-0000-4000-8000-000000000012',
    teamId,
    name: '验收助理',
    kind: 'direct',
    leaderBotId: null,
    lastMessageAt: stamp,
    responsibility: '',
    instructions: '',
    tags: [],
    botSettings: [],
    skillReferences: [],
    members: [
      { id: botId, name: '验收助理', kind: 'bot' },
      { id: userId, name: '负责人', kind: 'user' },
    ],
  }
  const markdown = [
    '**验收结果**：已检查。',
    '- 核对项目状态\n- 确认交付记录\n  1. 查阅验收记录',
    '> 部署窗口待确认。',
    '| 方法 | 路径 | 用途 |\n| --- | --- | --- |\n| GET | `/api/v1/projects` | 查看项目 |',
    '行内公式 $x^2 + y^2$',
    '```python\nimport json\napproved = True\n```',
  ].join('\n\n')
  const messages: Message[] = [
    {
      id: 'da55aa00-0000-4000-8000-000000000021',
      sequence: '1',
      speakerKind: 'bot',
      speakerId: botId,
      speakerName: room.name,
      body: { blocks: [{ type: 'text', text: markdown }] },
      runId,
      createdAt: stamp,
    },
  ]
  const attachment = { id: 'da55aa00-0000-4000-8000-000000000040', fileName: '验收记录.md', sizeBytes: 4 }
  const pastedImage = { id: 'da55aa00-0000-4000-8000-000000000041', fileName: '剪贴板截图.png', sizeBytes: 3 }
  const base = `**/api/v1/bot-conversations/${room.id}`
  const messageId = 'da55aa00-0000-4000-8000-000000000022'
  let uploadAttempts = 0
  let firstClientRequestId: string | undefined
  await page.route(`**/api/v1/teams/${teamId}/bot-conversations*`, (route) =>
    route.fulfill({
      json: success({ items: [{ ...room, botAvatars: [], lastMessagePreview: '验收结果' }], nextCursor: null }),
    }),
  )
  await page.route(base, (route) => route.fulfill({ json: success(room) }))
  await page.route(`${base}/tasks*`, (route) => route.fulfill({ json: success({ items: [], nextCursor: null }) }))
  await page.route(`${base}/events*`, (route) =>
    route.fulfill({ json: success({ items: [], cursor: '0', resetRequired: false, activeRuns: [] }) }),
  )
  await page.route('**/api/v1/attachments/policy', (route) =>
    route.fulfill({
      json: success({
        maxFileBytes: 1024 * 1024,
        maxFilesPerSubmit: 10,
        maxFilesPerRecord: 50,
        tempRetentionHours: 24,
      }),
    }),
  )
  await page.route(`${base}/attachments`, (route) => {
    if (route.request().headers()['x-file-type'] === 'image/png') {
      expect(route.request().postDataBuffer()).toEqual(Buffer.from([137, 80, 78]))
      return route.fulfill({
        json: success({
          attachment: { ...pastedImage, status: 'temp', contentType: 'image/png', sha256: 'test', uploadedAt: stamp },
        }),
      })
    }
    expect(route.request().postData()).toBe('test')
    expect(route.request().headers()['x-file-name']).toBe(encodeURIComponent(attachment.fileName))
    uploadAttempts += 1
    return route.fulfill({
      json:
        uploadAttempts === 1
          ? failure()
          : success({
              attachment: {
                ...attachment,
                status: 'temp',
                contentType: 'text/markdown',
                sha256: 'test',
                uploadedAt: stamp,
              },
            }),
    })
  })
  await page.route(`${base}/messages*`, (route) => {
    if (route.request().method() === 'GET')
      return route.fulfill({ json: success({ items: messages, nextBefore: null }) })
    const request = route.request().postDataJSON()
    expect(request).toMatchObject({ text: '请查看附件', attachmentIds: [attachment.id, pastedImage.id] })
    expect(request.clientRequestId).toBeTruthy()
    if (!firstClientRequestId) {
      firstClientRequestId = request.clientRequestId
      return route.fulfill({ json: failure() })
    }
    expect(request.clientRequestId).toBe(firstClientRequestId)
    const message: Message = {
      id: messageId,
      sequence: '2',
      speakerKind: 'user',
      speakerId: userId,
      speakerName: '负责人',
      body: { blocks: [{ type: 'text', text: request.text }], attachments: [attachment, pastedImage] },
      runId,
      createdAt: stamp,
    }
    messages.push(message)
    return route.fulfill({ json: success({ message, runId, delivery: 'queued' }) })
  })

  await page.goto(`/collaboration/${room.id}`)
  const composer = page.getByRole('textbox', { name: '协作消息' })
  await expect(composer).toBeVisible({ timeout: 30_000 })
  const initialHeight = (await composer.boundingBox())?.height ?? 0
  expect(initialHeight).toBeGreaterThanOrEqual(48)
  await composer.fill('第一行\n第二行\n第三行\n第四行')
  await expect.poll(async () => (await composer.boundingBox())?.height ?? 0).toBeGreaterThan(initialHeight)
  await composer.fill('请查看附件')

  await expect(page.locator('.dsh-markdown ul')).toHaveCSS('list-style-type', 'disc')
  await expect(page.locator('.dsh-markdown ol')).toHaveCSS('list-style-type', 'decimal')
  const code = page.locator('.conversation-code pre')
  await code.scrollIntoViewIfNeeded()
  await expect(code).toHaveText(/import json\s+approved = True/u)
  await expect(code.locator('.conversation-code-token').first()).toBeVisible()
  await expect(page.locator('.katex').first()).toBeVisible()
  await expect(page.getByRole('region', { name: '回复表格' })).toHaveAttribute('tabindex', '0')
  await expect(page.getByRole('table').getByRole('cell', { name: '查看项目' })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('conversation-markdown.png'), animations: 'disabled' })

  const actions = page.getByRole('button', { name: '消息操作' })
  await actions.press('Enter')
  const uploadAction = page.getByRole('menuitem', { name: '上传文件' })
  await expect(uploadAction).toBeEnabled()
  const iconSizes = await page
    .getByRole('menu')
    .locator('[role="menuitem"] > svg')
    .evaluateAll((icons) => icons.map((icon) => [getComputedStyle(icon).width, getComputedStyle(icon).height]))
  expect(iconSizes).toEqual(Array.from({ length: 4 }, () => ['16px', '16px']))
  await page.screenshot({ path: testInfo.outputPath('conversation-menu.png'), animations: 'disabled' })
  const choosing = page.waitForEvent('filechooser')
  await uploadAction.press('Enter')
  await (await choosing).setFiles({ name: attachment.fileName, mimeType: 'text/markdown', buffer: Buffer.from('test') })
  const uploadRail = page.getByRole('list', { name: '待发送附件' })
  const retryUpload = uploadRail.getByRole('button', { name: '重试 验收记录.md' })
  await expect(retryUpload).toBeVisible()
  const send = page.getByRole('button', { name: '发送消息' })
  await expect(send).toBeDisabled()
  await retryUpload.click()
  await expect(uploadRail.getByText('已上传', { exact: false })).toBeVisible()
  const passthrough = await composer.evaluate((element) => {
    const data = new DataTransfer()
    data.setData('text/plain', '普通文本')
    return element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
  })
  expect(passthrough).toBe(true)
  const imageOnly = await composer.evaluate((element) => {
    const data = new DataTransfer()
    data.items.add(new File([new Uint8Array([137, 80, 78])], '剪贴板截图.png', { type: 'image/png' }))
    return element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
  })
  expect(imageOnly).toBe(false)
  await expect(uploadRail.getByText(pastedImage.fileName)).toBeVisible()
  await expect(uploadRail.getByText('已上传', { exact: false })).toHaveCount(2)
  await expect(composer).toHaveValue('请查看附件')
  await page.screenshot({ path: testInfo.outputPath('conversation-attachment-draft.png'), animations: 'disabled' })

  await send.press('Enter')
  await expect(page.getByRole('alert')).toHaveText('附件存储暂时不可用，请联系平台管理员。')
  await expect(composer).toHaveValue('请查看附件')
  await expect(uploadRail.getByText(attachment.fileName)).toBeVisible()
  await send.press('Enter')
  await expect(page.getByRole('link', { name: '下载 验收记录.md' })).toHaveAttribute(
    'href',
    `/api/v1/bot-conversations/${room.id}/messages/${messageId}/attachments/${attachment.id}/download`,
  )
  await expect(page.getByRole('link', { name: '下载 剪贴板截图.png' })).toBeVisible()
  await expect(uploadRail).toHaveCount(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('conversation-attachment-sent.png'), animations: 'disabled' })
  if (testInfo.project.name === 'desktop') {
    await page.evaluate(() => document.documentElement.classList.add('dark'))
    await page.screenshot({ path: testInfo.outputPath('conversation-dark.png'), animations: 'disabled' })
  }
})
