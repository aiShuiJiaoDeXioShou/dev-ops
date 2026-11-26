import { expect, test } from '@playwright/test'
import type { ApiSuccessData } from '@dev-ops/api-client'
import { VISUAL_IDS } from './fixtures'
import { installApiMocks } from './mock-api'

type Room = ApiSuccessData<'/api/v1/bot-conversations/{conversationId}', 'get'>
type Message = ApiSuccessData<'/api/v1/bot-conversations/{conversationId}/messages', 'get'>['items'][number]

function success(data: unknown) {
  return { success: true, code: 'OK', message: 'OK', requestId: 'conversation-visual-test', data }
}

test('[desktop] [mobile] 私聊沿用原型并展示排队、增量与最终消息', async ({ page }, testInfo) => {
  await installApiMocks(page)
  const { teamId, userId } = VISUAL_IDS
  const tagId = 'da55aa00-0000-4000-8000-000000000090'
  const tag = { id: tagId, name: '交付', updatedAt: '2026-11-17T08:00:00.000Z' }
  const teamTags = [tag]
  await page.route(`**/api/v1/teams/${teamId}/work-tags*`, (route) => {
    if (route.request().method() === 'POST') {
      const name = route.request().postDataJSON().name
      const created = { ...tag, id: 'da55aa00-0000-4000-8000-000000000091', name }
      teamTags.push(created)
      return route.fulfill({ json: success(created) })
    }
    return route.fulfill({ json: success({ items: teamTags, nextCursor: null }) })
  })
  const stamp = '2026-11-17T08:00:00.000Z'
  const botId = 'da55aa00-0000-4000-8000-000000000011'
  await page.route(`**/api/v1/teams/${teamId}/bot-memories*`, (route) =>
    route.fulfill({
      json: success({
        items: [
          {
            id: 'da55aa00-0000-4000-8000-000000000092',
            botId,
            botName: '验收助理',
            scope: 'user',
            content: '验收结论先给结果，再列证据',
            essential: true,
            sourceUserName: '负责人',
            sourceConversationId: null,
            sourceConversationName: null,
            updatedAt: stamp,
            canEdit: true,
            canRemove: true,
          },
        ],
        nextCursor: null,
      }),
    }),
  )
  const skillId = 'da55aa00-0000-4000-8000-000000000014'
  const runId = 'da55aa00-0000-4000-8000-000000000020'
  const skill = {
    id: skillId,
    name: '交付复核',
    identifier: 'delivery-review',
    summary: '核对证据',
    category: 'delivery',
    source: 'team',
    fileCount: 0,
    enabled: true,
    version: 1,
    contentVersion: '1.0.0',
    teamId,
    content: '按验收条件核对证据。',
    files: [],
    createdByUserId: userId,
    createdAt: stamp,
    updatedAt: stamp,
  } satisfies ApiSuccessData<'/api/v1/skills/{skillId}', 'get'>
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
    skillReferences: [
      { id: skillId, name: '交付复核', identifier: 'delivery-review', summary: '核对证据', botIds: [botId] },
    ],
    members: [
      { id: botId, name: '验收助理', kind: 'bot' },
      { id: userId, name: '负责人', kind: 'user' },
    ],
  }
  let stage: 'empty' | 'queued' | 'running' | 'complete' = 'empty'
  let activeAt = stamp
  let runningCursor = 6
  const list: Message[] = []
  await page.route(`**/api/v1/teams/${teamId}/bot-inbox`, (route) =>
    route.fulfill({ json: success({ items: [], count: 0 }) }),
  )
  const messagePath = `**/api/v1/bot-conversations/${room.id}/messages`
  await page.route(`**/api/v1/bot-conversations/${room.id}/tasks*`, (route) =>
    route.fulfill({ json: success({ items: [], nextCursor: null }) }),
  )
  const eventsPath = `**/api/v1/bot-conversations/${room.id}/events`
  await page.route(`**/api/v1/teams/${teamId}/bot-conversations*`, (route) => {
    if (route.request().method() === 'POST') {
      expect(route.request().postDataJSON()).toEqual({ kind: 'direct', botId })
      return route.fulfill({ json: success(room) })
    }
    const filtered = new URL(route.request().url()).searchParams.get('tagId') === tagId
    return route.fulfill({
      json: success({
        items:
          filtered && !room.tags.length
            ? []
            : [
                {
                  ...room,
                  botAvatars: [{ id: botId, avatarKey: 'orbit', enabled: true }],
                  lastMessagePreview: list.at(-1)?.body.blocks[0]?.text ?? null,
                },
              ],
        nextCursor: null,
      }),
    })
  })
  await page.route(`**/api/v1/bot-conversations/${room.id}`, (route) => route.fulfill({ json: success(room) }))
  const bot: ApiSuccessData<'/api/v1/bots/{botId}', 'get'> = {
    id: botId,
    teamId,
    name: room.name,
    responsibility: '核对交付证据',
    instructions: '',
    avatarKey: 'orbit',
    ownerUserId: userId,
    ownerName: '负责人',
    status: 'enabled',
    availability: 'available',
    accessMode: 'sandbox',
    configVersion: 1,
    modelConnectionId: null,
    connectionName: null,
    modelId: 'deepseek-flash',
    updatedAt: stamp,
    lastActiveAt: null,
    skillIds: [skillId],
  } satisfies ApiSuccessData<'/api/v1/bots/{botId}', 'get'>
  await page.route(`**/api/v1/bots/${botId}`, (route) => route.fulfill({ json: success(bot) }))
  await page.route(`**/api/v1/bots/${botId}/set-access`, (route) => {
    expect(route.request().postDataJSON()).toMatchObject({ configVersion: bot.configVersion, accessMode: 'full' })
    bot.accessMode = 'full'
    bot.configVersion++
    return route.fulfill({ json: success(bot) })
  })
  await page.route(`**/api/v1/teams/${teamId}/bots*`, (route) =>
    route.fulfill({
      json: success({
        items: [
          bot,
          { ...bot, id: 'da55aa00-0000-4000-8000-000000000017', name: '未配置助理', skillIds: [] },
          { ...bot, id: 'da55aa00-0000-4000-8000-000000000018', name: '离线助理', availability: 'worker_offline' },
        ],
        nextCursor: null,
      }),
    }),
  )
  await page.route(`**/api/v1/teams/${teamId}/skills*`, (route) =>
    route.fulfill({ json: success({ items: [skill], page: 1, pageSize: 20, total: 1 }) }),
  )
  await page.route(`**/api/v1/skills/${skillId}`, (route) => route.fulfill({ json: success(skill) }))
  await page.route('**/api/v1/work-tags/*/link', (route) => {
    expect(route.request().postDataJSON()).toEqual({ targetKind: 'conversation', targetId: room.id })
    const id = new URL(route.request().url()).pathname.split('/').at(-2)
    const selected = teamTags.find((item) => item.id === id)
    if (!selected) throw new Error('测试标签不存在')
    room.tags = [...room.tags.filter((item) => item.id !== id), selected]
    return route.fulfill({ json: success({ id }) })
  })
  await page.route('**/api/v1/work-tags/*/unlink', (route) => {
    const id = new URL(route.request().url()).pathname.split('/').at(-2)
    room.tags = room.tags.filter((item) => item.id !== id)
    return route.fulfill({ json: success({ id }) })
  })
  await page.route(`${messagePath}*`, (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: success({ items: list, nextBefore: null }) })
    const input = route.request().postDataJSON()
    expect(input).toMatchObject({ text: '@验收助理 检查结果', mentionBotIds: [botId] })
    expect(input.clientRequestId).toBeTruthy()
    const message: Message = {
      id: 'da55aa00-0000-4000-8000-000000000021',
      sequence: '1',
      speakerKind: 'user',
      speakerId: userId,
      speakerName: '负责人',
      body: { blocks: [{ type: 'text', text: input.text }] },
      runId,
      createdAt: stamp,
    }
    list.push(message)
    stage = 'queued'
    return route.fulfill({ json: success({ message, runId, delivery: 'queued' }) })
  })
  await page.route(`${eventsPath}*`, (route) => {
    const after = Number(new URL(route.request().url()).searchParams.get('after') ?? '0')
    const allEvents = [
      { sequence: '1', kind: 'run_status', runId, payload: { status: 'queued' }, createdAt: stamp },
      { sequence: '2', kind: 'run_status', runId, payload: { status: 'running', botId }, createdAt: activeAt },
      { sequence: '3', kind: 'output_delta', runId, payload: { text: '正在检查' }, createdAt: activeAt },
      {
        sequence: '4',
        kind: 'tool_activity',
        runId,
        payload: { state: 'started', callId: 'read-1', name: 'read' },
        createdAt: activeAt,
      },
      {
        sequence: '5',
        kind: 'tool_activity',
        runId,
        payload: { state: 'finished', callId: 'read-1', name: 'read', ok: true },
        createdAt: activeAt,
      },
      { sequence: '6', kind: 'output_delta', runId, payload: { text: '正在整理结果' }, createdAt: activeAt },
      { sequence: '7', kind: 'output_delta', runId, payload: { text: '，即将完成' }, createdAt: activeAt },
      { sequence: '8', kind: 'run_status', runId, payload: { status: 'succeeded' }, createdAt: activeAt },
      { sequence: '9', kind: 'message_committed', runId, payload: {}, createdAt: activeAt },
    ]
    const cursor = { empty: 0, queued: 1, running: runningCursor, complete: allEvents.length }[stage]
    const activeRuns =
      stage === 'empty' || stage === 'complete'
        ? []
        : [
            {
              id: runId,
              botId,
              status: stage,
              ...(stage === 'queued' ? { queueReason: 'worker_offline', teamQueuePosition: 2 } : {}),
            },
          ]
    return route.fulfill({
      json: success({
        items: allEvents.slice(after, cursor),
        cursor: String(cursor),
        resetRequired: false,
        activeRuns,
      }),
    })
  })

  await page.route(`${messagePath}/*/feedback`, (route) => {
    const value = route.request().postDataJSON().rating
    const message = list.at(-1)
    if (message) message.feedback = value
    return route.fulfill({ json: success({ id: message?.id, rating: value }) })
  })
  await page.goto(`/collaboration/${room.id}`)
  const tabs = page.getByRole('tablist', { name: '会话视图' })
  await expect(tabs.getByRole('tab')).toHaveCount(2, { timeout: 15_000 })
  await expect(tabs.getByRole('tab', { name: '对话' })).toBeVisible()
  await expect(tabs.getByRole('tab', { name: '轨迹' })).toBeVisible()
  if (testInfo.project.name === 'mobile') {
    const toggle = page.getByRole('button', { name: '打开会话列表' })
    await expect(page.getByRole('button', { name: '打开导航', exact: true })).toHaveCount(0)
    await toggle.press('Enter')
    await expect(page.getByRole('searchbox', { name: '搜索会话' })).toBeVisible()
    await page.getByRole('button', { name: '打开导航', exact: true }).press('Enter')
    await expect(page.getByRole('dialog', { name: '工作区导航' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(toggle).toBeFocused()
  }
  const composer = page.getByRole('textbox', { name: '协作消息' })
  await expect(composer).toHaveCSS('background-image', 'none')
  await expect(composer).toHaveCSS('font-size', '16px')
  expect(await composer.evaluate((element) => getComputedStyle(element, '::placeholder').fontSize)).toBe('16px')
  await composer.fill('@')
  const references = page.getByRole('group', { name: 'Bot 候选' })
  await expect(references.getByText('Bot', { exact: true })).toBeVisible()
  await expect(references.getByText('技能 · 交付复核', { exact: true })).toHaveCount(0)
  await composer.press('Enter')
  await expect(composer).toHaveValue('@验收助理 ')
  await composer.fill('@验收助理 检查结果')
  await page.getByRole('button', { name: '发送消息' }).press('Enter')
  await expect(page.getByText('排队中 · 执行服务离线 · 团队队列第 2 位', { exact: true })).toBeVisible({
    timeout: 3000,
  })
  activeAt = new Date(Date.now() - 12_000).toISOString()
  stage = 'running'
  const work = page.getByRole('region', { name: '工作过程' })
  await expect(work.locator('summary').getByText('正在检查', { exact: true })).toBeVisible()
  await expect(work.getByText('read', { exact: true })).toBeVisible()
  await expect(work.getByText('正在整理结果', { exact: true })).toBeVisible()
  await expect(work.getByRole('button', { name: '正在工作' })).toHaveAttribute('aria-expanded', 'true')
  await expect(page.locator('.dsh-assistant-head')).toHaveCount(0)
  const stopButton = page.getByRole('button', { name: '停止生成' })
  const stopSize = testInfo.project.name === 'mobile' ? '44px' : '34px'
  await expect(stopButton).toBeVisible()
  await expect(stopButton).toHaveCSS('width', stopSize)
  await expect(stopButton).toHaveCSS('height', stopSize)
  await expect(stopButton).toHaveCSS('background-color', 'rgb(65, 118, 230)')
  await expect(page.getByRole('button', { name: '发送消息' })).toHaveCount(0)
  await expect(stopButton.locator('.dsh-send-ring')).toHaveCount(0)
  await expect(work.locator('.dsh-cursor')).toHaveCount(0)
  await expect(page.getByText('正在准备回复…', { exact: true })).toHaveCount(0)
  await expect(page.locator('.dsh-running')).toHaveCount(0)
  await expect(page.locator('.conversation-work-header .dsh-running-time')).toBeVisible()
  runningCursor = 7
  await expect(work.getByText('正在整理结果，即将完成', { exact: true })).toBeVisible()
  await expect(work.locator('.dsh-cursor')).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('bot-conversations-running.png'), animations: 'disabled' })
  const composerBox = page.locator('.conversation-composer')
  await composerBox.screenshot({ path: testInfo.outputPath('bot-conversations-composer.png'), animations: 'disabled' })
  if (testInfo.project.name === 'desktop') {
    await page.evaluate(() => document.documentElement.classList.add('dark'))
    await expect(stopButton).toHaveCSS('background-color', 'rgb(122, 160, 240)')
    await composerBox.screenshot({
      path: testInfo.outputPath('bot-conversations-composer-dark.png'),
      animations: 'disabled',
    })
    await page.evaluate(() => document.documentElement.classList.remove('dark'))
  }
  await composer.fill('尚未发送的草稿')
  const trajectoryTab = page.getByRole('tab', { name: '轨迹' })
  if (testInfo.project.name === 'mobile') await trajectoryTab.tap()
  else await trajectoryTab.click()
  await expect(page.getByRole('region', { name: '运行详情' })).toBeVisible()
  await expect(trajectoryTab).toHaveCSS('outline-style', 'none')
  await expect(trajectoryTab).toHaveCSS('box-shadow', 'none')
  await page.screenshot({ path: testInfo.outputPath('bot-conversations-trace.png'), animations: 'disabled' })
  await page.keyboard.press('ArrowLeft')
  const chatTab = page.getByRole('tab', { name: '对话' })
  await expect(chatTab).toBeFocused()
  await expect(chatTab).toHaveCSS('outline-style', 'solid')
  await expect(composer).toHaveValue('尚未发送的草稿')
  list.push({
    id: 'da55aa00-0000-4000-8000-000000000022',
    sequence: '2',
    speakerKind: 'bot',
    speakerId: botId,
    speakerName: '验收助理',
    body: {
      metrics: {
        inputTokens: 1000,
        outputTokens: 200,
        cacheReadTokens: 50,
        cacheWriteTokens: 0,
        costUsd: 0.001,
        turns: 2,
        durationMs: 8600,
      },
      blocks: [
        {
          type: 'text',
          text: '**验收结果**：已检查。\n\n| 方法 | 路径 | 用途 |\n| --- | --- | --- |\n| GET | `/api/v1/projects` | 查看项目 |',
        },
      ],
    },
    runId,
    createdAt: stamp,
  })
  stage = 'complete'
  await expect(page.getByText('验收结果', { exact: true })).toBeVisible()
  const workToggle = work.getByRole('button', { name: /已工作/ })
  await expect(workToggle).toHaveAttribute('aria-expanded', 'false')
  await expect(work.locator('summary').getByText('正在检查', { exact: true })).toBeHidden()
  await workToggle.press('Enter')
  await expect(work.locator('summary').getByText('正在检查', { exact: true })).toBeVisible()
  await expect(work.getByText('正在整理结果，即将完成', { exact: true })).toHaveCount(0)
  await workToggle.press('Enter')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(work.locator('.conversation-work-content')).toHaveCSS('transition-duration', '0s')
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await expect(page.getByText('查看轨迹', { exact: true })).toHaveCount(0)
  await expect(page.getByText('Enter 发送 · Shift+Enter 换行', { exact: true })).toBeVisible()
  await expect(page.getByRole('table').getByRole('columnheader')).toHaveCount(3)
  await expect(page.getByRole('table').getByRole('cell', { name: '查看项目' })).toBeVisible()
  const footer = page.getByRole('group', { name: '回答操作' })
  if (testInfo.project.name === 'desktop') {
    await page.mouse.move(0, 0)
    await expect(footer.locator('.dsh-answer-controls')).toHaveCSS('opacity', '0')
    await footer.hover()
  }
  await expect(footer.locator('.dsh-answer-controls')).toHaveCSS('opacity', '1')
  await footer.getByRole('button', { name: '回答有帮助', exact: true }).click()
  await expect(footer.getByRole('button', { name: '回答有帮助', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await footer.getByRole('button', { name: '回答有帮助', exact: true }).click()
  await expect(footer.getByRole('button', { name: '回答有帮助', exact: true })).toHaveAttribute('aria-pressed', 'false')
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await footer.getByRole('button', { name: '复制回答', exact: true }).click()
  await expect(footer.getByRole('button', { name: '已复制回答', exact: true })).toBeVisible()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('| 方法 | 路径 | 用途 |')
  await footer.getByRole('button', { name: '复制回答链接', exact: true }).click()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(
    `/collaboration/${room.id}#message-da55aa00-0000-4000-8000-000000000022`,
  )
  const fork = footer.getByRole('button', { name: '从这里分叉', exact: true })
  await expect(fork).toHaveText('')
  const buttons = await footer.getByRole('button').all()
  const labels = await Promise.all(buttons.map((button) => button.getAttribute('aria-label')))
  expect(labels.indexOf('从这里分叉')).toBe(labels.indexOf('回答无帮助') + 1)
  await fork.press('Enter')
  await expect(page.getByRole('dialog', { name: '从这里分叉' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(fork).toBeFocused()
  await footer.getByRole('button', { name: '回答详情', exact: true }).press('Enter')
  await expect(page.getByText('输入 Token', { exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(footer.getByRole('button', { name: '回答详情', exact: true })).toBeFocused()
  await page.screenshot({ path: testInfo.outputPath('bot-answer-footer.png'), animations: 'disabled' })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('bot-conversations.png') })
  if (testInfo.project.name === 'mobile') await page.getByRole('button', { name: '打开会话列表' }).press('Enter')
  await page.getByRole('button', { name: /等你回复/ }).press('Enter')
  if (testInfo.project.name === 'mobile') await page.getByRole('button', { name: '打开会话列表' }).press('Enter')
  await page.locator('.conversation-item').filter({ hasText: room.name }).press('Enter')
  await expect(composer).toHaveValue('尚未发送的草稿')
  if (testInfo.project.name === 'mobile') await page.getByRole('button', { name: '打开会话列表' }).press('Enter')
  const filterTrigger = page.getByRole('button', { name: '会话筛选' })
  // 筛选入口只放漏斗图标，不再占用文字宽度。
  await expect(filterTrigger).toHaveText('')
  await filterTrigger.press('Enter')
  const filterPanel = page.getByRole('dialog', { name: '会话筛选' })
  await filterPanel.getByRole('combobox', { name: '工作标签' }).selectOption(tagId)
  await filterPanel.getByRole('button', { name: '应用筛选' }).press('Enter')
  await expect(page.getByRole('button', { name: '会话筛选，已应用 1 个条件' })).toBeVisible()
  await expect(page.getByText('没有匹配的会话')).toBeVisible()

  if (testInfo.project.name === 'mobile') await page.getByRole('button', { name: '收起会话列表' }).press('Enter')
  const settings = page.getByRole('button', { name: '会话设置', exact: true })
  await settings.press('Enter')
  const settingsPanel = page.getByRole('complementary', { name: '会话设置' })
  const access = settingsPanel.getByRole('combobox', { name: /工具访问权限/ })
  await expect(access).toHaveValue('sandbox')
  await access.selectOption('full')
  const accessConfirm = page.getByRole('alertdialog', { name: /完全访问执行主机/ })
  await expect(accessConfirm.getByRole('button', { name: '取消' })).toBeFocused()
  await accessConfirm.getByRole('button', { name: '取消' }).press('Enter')
  await expect(access).toHaveValue('sandbox')
  await expect(access).toBeFocused()
  await access.selectOption('full')
  await page.getByRole('alertdialog').getByRole('button', { name: '允许完全访问' }).click()
  await expect(access).toHaveValue('full')
  await expect(access).toBeFocused()
  await expect(settingsPanel.getByText('允许工具访问执行主机上的其他目录。')).toBeVisible()
  // 紧凑标签编辑器的选择与新建在「+」弹出层中。
  const tagEditor = page.getByRole('dialog', { name: '工作标签编辑' })
  await settingsPanel.getByRole('button', { name: '编辑工作标签' }).press('Enter')
  await tagEditor.getByRole('combobox', { name: '选择已有工作标签' }).press('Enter')
  await page.getByRole('listbox').getByRole('option', { name: '交付', exact: true }).click()
  await expect(settingsPanel.getByRole('button', { name: '移除标签交付' })).toBeVisible()
  await tagEditor.getByRole('textbox', { name: '新建工作标签' }).fill('排障')
  await tagEditor.getByRole('textbox', { name: '新建工作标签' }).press('Enter')
  await expect(settingsPanel.getByRole('button', { name: '移除标签排障' })).toBeEnabled()
  await page.keyboard.press('Escape')
  await settingsPanel.getByRole('button', { name: '移除标签排障' }).click()
  await expect(settingsPanel.getByRole('button', { name: '移除标签排障' })).toHaveCount(0)
  await expect(settingsPanel.getByRole('link', { name: '管理记忆' })).toHaveAttribute(
    'href',
    `/capabilities/memory?botId=${botId}`,
  )

  // 管理工作标签：一行新建、行内改名，改名时 Esc 只取消改名而不关闭弹窗。
  await settingsPanel.getByRole('button', { name: '编辑工作标签' }).press('Enter')
  await tagEditor.getByRole('button', { name: '管理标签' }).press('Enter')
  const manager = page.getByRole('dialog', { name: '管理工作标签' })
  await expect(manager.getByRole('textbox', { name: '新标签名称' })).toBeFocused()
  const tagRow = manager.locator('.work-tag-manage-row').first()
  if (testInfo.project.name === 'desktop') await tagRow.hover()
  await expect(tagRow.locator('.work-tag-manage-actions')).toHaveCSS('opacity', '1')
  await page.screenshot({ path: testInfo.outputPath('work-tag-manager.png'), animations: 'disabled' })
  const renameDelivery = manager.getByRole('button', { name: '改名标签「交付」' })
  await renameDelivery.press('Enter')
  const renameInput = manager.getByRole('textbox', { name: '标签「交付」的新名称' })
  await expect(renameInput).toHaveValue('交付')
  await page.keyboard.press('Escape')
  await expect(renameInput).toHaveCount(0)
  await expect(manager).toBeVisible()
  await expect(renameDelivery).toBeFocused()
  const deleteDelivery = manager.getByRole('button', { name: '删除标签「交付」' })
  await deleteDelivery.press('Enter')
  const deleteConfirm = page.getByRole('alertdialog', { name: '删除标签「交付」？' })
  await expect(deleteConfirm.getByRole('button', { name: '取消' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(deleteDelivery).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(manager).toBeHidden()
  if (await tagEditor.isVisible()) await page.keyboard.press('Escape')
  await expect(tagEditor).toBeHidden()

  // 桌面悬停标签才显示右上角的移除按钮；触屏常显。
  const deliveryTag = settingsPanel.locator('.work-tag-chip').filter({ hasText: '交付' })
  const removeDelivery = deliveryTag.getByRole('button', { name: '移除标签交付' })
  if (testInfo.project.name === 'desktop') {
    await expect(removeDelivery).toHaveCSS('opacity', '0')
    await deliveryTag.hover()
  }
  await expect(removeDelivery).toHaveCSS('opacity', '1')
  await page.screenshot({ path: testInfo.outputPath('bot-direct-settings.png'), animations: 'disabled' })
  await page.keyboard.press('Escape')
  await expect(settings).toBeFocused()
  await expect(settingsPanel).toBeHidden()
  if (testInfo.project.name === 'mobile') await page.getByRole('button', { name: '打开会话列表' }).press('Enter')
  await expect(page.locator('.conversation-item').filter({ hasText: room.name })).toBeVisible()

  await page.goto(`/capabilities/skills?skill=${skillId}`)
  const useSkill = page.getByRole('button', { name: '在 Bots 中使用' })
  await useSkill.press('Enter')
  const picker = page.getByRole('dialog', { name: '使用 交付复核' })
  const eligibleBot = picker.getByRole('button', { name: /验收助理/ })
  await expect(eligibleBot).toBeVisible()
  await expect(picker.getByRole('button', { name: /未配置助理|离线助理/ })).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('skill-bot-picker.png'), animations: 'disabled' })
  await page.keyboard.press('Escape')
  await expect(useSkill).toBeFocused()
  await useSkill.press('Enter')
  await eligibleBot.press('Enter')
  await expect(page).toHaveURL(new RegExp(`/collaboration/${room.id}\\?skill=${skillId}$`))
  await expect(page.getByRole('textbox', { name: '协作消息' })).toHaveValue('/skill:delivery-review ')
})

test('[desktop] [mobile] 在对话和轨迹停止生成并保留已经输出的正文', async ({ page }, testInfo) => {
  await installApiMocks(page)
  const { teamId, userId } = VISUAL_IDS
  const stamp = new Date().toISOString()
  const botId = 'da55aa00-0000-4000-8000-000000000061'
  const roomId = 'da55aa00-0000-4000-8000-000000000062'
  const runId = 'da55aa00-0000-4000-8000-000000000063'
  const room: Room = {
    id: roomId,
    teamId,
    kind: 'direct',
    name: '实施助理',
    leaderBotId: null,
    lastMessageAt: stamp,
    responsibility: '',
    instructions: '',
    tags: [],
    botSettings: [],
    skillReferences: [],
    members: [
      { id: userId, kind: 'user', name: '当前成员' },
      { id: botId, kind: 'bot', name: '实施助理', avatarKey: 'orbit', enabled: true },
    ],
  }

  const base = `**/api/v1/bot-conversations/${roomId}`
  let stops = 0
  await page.route(`**/api/v1/teams/${teamId}/bot-conversations*`, (route) =>
    route.fulfill({
      json: success({
        items: [{ ...room, botAvatars: [{ id: botId, avatarKey: 'orbit', enabled: true }], lastMessagePreview: null }],
        nextCursor: null,
      }),
    }),
  )
  await page.route(base, (route) => route.fulfill({ json: success(room) }))
  await page.route(`${base}/tasks*`, (route) => route.fulfill({ json: success({ items: [], nextCursor: null }) }))
  await page.route(`${base}/messages*`, (route) => route.fulfill({ json: success({ items: [], nextBefore: null }) }))
  await page.route(`${base}/events*`, (route) => {
    const after = Number(new URL(route.request().url()).searchParams.get('after') ?? '0')
    const events = [
      { sequence: '1', kind: 'run_status', runId, payload: { status: 'running', botId }, createdAt: stamp },
      { sequence: '2', kind: 'output_delta', runId, payload: { text: '已收到的正文片段' }, createdAt: stamp },
      { sequence: '3', kind: 'run_status', runId, payload: { status: 'stopped', botId }, createdAt: stamp },
    ]
    const cursor = stops ? 3 : 2
    return route.fulfill({
      json: success({
        items: events.slice(after, cursor),
        cursor: String(cursor),
        resetRequired: false,
        activeRuns: stops ? [] : [{ id: runId, botId, status: 'running' }],
      }),
    })
  })
  await page.route(`**/api/v1/bot-runs/${runId}/stop`, (route) => {
    expect(route.request().method()).toBe('POST')
    stops++
    return route.fulfill({
      json: success({
        id: runId,
        botId,
        triggerUserId: userId,
        inputVersion: 0,
        status: 'stopped',
        stopRequested: true,
        createdAt: stamp,
        startedAt: stamp,
        finishedAt: stamp,
        modelConnectionId: null,
        modelId: null,
        failureKind: null,
        failureMessage: null,
        turns: 0,
        skillVersions: [],
        usage: null,
      }),
    })
  })

  await page.goto(`/collaboration/${roomId}`)
  await expect(page.getByText('已收到的正文片段')).toBeVisible()
  if (testInfo.project.name === 'desktop') {
    const nav = page.getByRole('link', { name: '协作', exact: true })
    const body = nav.locator('.nav-bot-body')
    await expect(body).toHaveCSS('animation-name', 'nav-bot-sway')
    await nav.hover()
    await expect(body).toHaveCSS('animation-name', 'nav-bot-greet')
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await expect(body).toHaveCSS('animation-name', 'none')
    await page.getByRole('tab', { name: '轨迹' }).press('Enter')
  }
  await page.getByRole('button', { name: '停止生成' }).press('Enter')
  await expect.poll(() => stops).toBe(1)
  await page.getByRole('tab', { name: '对话' }).press('Enter')
  await expect(page.getByText('已停止生成', { exact: true })).toBeVisible()
  await expect(page.getByText('已收到的正文片段')).toBeVisible()
  await expect(page.getByText('已保留部分结果')).toBeVisible()
  await expect(page.getByRole('button', { name: '停止生成' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '发送消息' })).toBeDisabled()
  await page.screenshot({ path: testInfo.outputPath('bot-conversations-stopped.png'), animations: 'disabled' })
})

test('[desktop] [mobile] 运行失败的原因挂在触发消息下而不是常驻消息末尾', async ({ page }, testInfo) => {
  await installApiMocks(page)
  const { teamId, userId } = VISUAL_IDS
  const stamp = '2026-11-17T08:00:00.000Z'
  const botId = 'da55aa00-0000-4000-8000-000000000011'
  const runId = 'da55aa00-0000-4000-8000-000000000020'
  const messageId = 'da55aa00-0000-4000-8000-000000000021'
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
  const list: Message[] = [
    {
      id: messageId,
      sequence: '1',
      speakerKind: 'user',
      speakerId: userId,
      speakerName: '负责人',
      body: { blocks: [{ type: 'text', text: '我当前有多少个项目？' }] },
      runId,
      createdAt: stamp,
    },
  ]
  await page.route(`**/api/v1/teams/${teamId}/bot-inbox`, (route) =>
    route.fulfill({ json: success({ items: [], count: 0 }) }),
  )
  await page.route(`**/api/v1/teams/${teamId}/bot-conversations*`, (route) => {
    if (route.request().method() === 'POST') return route.fulfill({ json: success(room) })
    return route.fulfill({
      json: success({
        items: [{ ...room, botAvatars: [{ id: botId, avatarKey: null, enabled: true }], lastMessagePreview: null }],
        nextCursor: null,
      }),
    })
  })
  await page.route(`**/api/v1/bot-conversations/${room.id}`, (route) => route.fulfill({ json: success(room) }))
  await page.route(`**/api/v1/bot-conversations/${room.id}/messages*`, (route) =>
    route.fulfill({ json: success({ items: list, nextBefore: null }) }),
  )
  await page.route(`**/api/v1/bot-conversations/${room.id}/tasks*`, (route) =>
    route.fulfill({ json: success({ items: [], nextCursor: null }) }),
  )
  const failureEvent = {
    sequence: '3',
    kind: 'run_status',
    runId,
    payload: { status: 'failed', failureMessage: '执行服务已关闭，可重新运行任务' },
    createdAt: stamp,
  }
  // 失败前是否有增量正文，决定原因展示在触发消息下还是已有正文的气泡里。
  let withPartialText = false
  await page.route(`**/api/v1/bot-conversations/${room.id}/events*`, (route) => {
    const after = Number(new URL(route.request().url()).searchParams.get('after') ?? '0')
    const events = [
      { sequence: '1', kind: 'run_status', runId, payload: { status: 'running', botId }, createdAt: stamp },
      ...(withPartialText
        ? [{ sequence: '2', kind: 'output_delta', runId, payload: { text: '已收到的正文片段' }, createdAt: stamp }]
        : []),
      failureEvent,
    ]
    return route.fulfill({
      json: success({ items: events.slice(after), cursor: '3', resetRequired: false, activeRuns: [] }),
    })
  })

  const failureText = '执行失败 · 执行服务已关闭，可重新运行任务'
  await page.goto(`/collaboration/${room.id}`)
  const triggerMessage = page.locator(`#message-${messageId}`)
  await expect(triggerMessage.getByText(failureText, { exact: true })).toBeVisible({ timeout: 20_000 })
  // 失败的运行不提交助手消息：不再渲染空的助手气泡，原因随触发消息一起滚动。
  await expect(page.locator('.dsh-message.dsh-assistant')).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('bot-conversations-failed.png'), animations: 'disabled' })
  await page.reload()
  await expect(triggerMessage.getByText(failureText, { exact: true })).toBeVisible({ timeout: 20_000 })
  await expect(page.locator('.dsh-message.dsh-assistant')).toHaveCount(0)

  // 已有增量正文时保留气泡并只提示一次，不再把原因重复挂在触发消息下。
  withPartialText = true
  await page.reload()
  await expect(page.getByText('已收到的正文片段', { exact: true })).toBeVisible({ timeout: 20_000 })
  await expect(page.locator('.dsh-message.dsh-assistant').getByText(failureText, { exact: true })).toBeVisible()
  await expect(triggerMessage.getByText(failureText, { exact: true })).toHaveCount(0)
})
