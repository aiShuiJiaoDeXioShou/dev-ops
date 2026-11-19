import { expect, test } from '@playwright/test'
import { apiFixtures, VISUAL_IDS } from './fixtures'
import { installApiMocks } from './mock-api'

const demoBugId = '2a002077-b73a-44f9-8548-302f3c68a850'
const timestamp = '2026-11-17T00:00:00.000Z'
const demoBug = {
  id: demoBugId,
  teamId: VISUAL_IDS.teamId,
  projectId: VISUAL_IDS.projectId,
  number: 23,
  title: '上传附件后提示失败',
  status: 'in_fix',
  fixOwner: null,
  regressionOwner: null,
  version: 1,
  updatedAt: timestamp,
  createdAt: timestamp,
  createdByUserId: VISUAL_IDS.userId,
  phenomenon: '上传完成后出现错误提示。',
  expectedBehavior: '上传完成后显示附件。',
  reproduction: '在详情中上传附件。',
  reproductionUnknown: false,
  evidenceText: null,
  evidenceUrl: null,
  collaborators: [],
  attachments: [],
  linkedRequirements: [],
  regressions: [],
  linkedCodeReferences: [],
}
function envelope(data: unknown) {
  return { success: true, code: 'OK', message: 'OK', requestId: 'work-item-visual', data }
}

for (const kind of ['requirements', 'bugs'] as const) {
  test(`[desktop] [mobile] ${kind} 点击时间线切换任务并保存节点与可选排期`, async ({ page }, testInfo) => {
    await installApiMocks(page)
    const isRequirement = kind === 'requirements'
    const projectPath = `/projects/${VISUAL_IDS.projectId}/${kind}`
    const itemId = isRequirement ? VISUAL_IDS.requirementId : demoBugId
    const itemPath = `/api/v1/${kind}/${itemId}`
    const fixture = apiFixtures[itemPath]
    let detail: Record<string, unknown> = { ...demoBug }
    if (isRequirement) {
      if (
        !fixture ||
        typeof fixture !== 'object' ||
        !('data' in fixture) ||
        !fixture.data ||
        typeof fixture.data !== 'object'
      )
        throw new Error('缺少需求详情数据')
      detail = { ...fixture.data, status: 'in_testing' }
    } else {
      await page.route(`**/api/v1${projectPath}?*`, (route) =>
        route.fulfill({ json: envelope({ items: [demoBug], page: 1, pageSize: 20, total: 1 }) }),
      )
    }
    await page.goto(projectPath)
    const avatar = await page.evaluate(() => {
      const canvas = document.createElement('canvas')
      canvas.width = 64
      canvas.height = 64
      const context = canvas.getContext('2d')
      if (!context) throw new Error('无法构造头像')
      context.fillStyle = 'royalblue'
      context.fillRect(0, 0, 64, 64)
      context.fillStyle = 'white'
      context.fillRect(20, 20, 24, 24)
      return canvas.toDataURL('image/jpeg')
    })
    const person = { userId: VISUAL_IDS.userId, name: '林辰', image: avatar, status: 'active', available: true }
    const role = isRequirement ? 'test' : 'fix'
    detail = { ...detail, [`${role}Owner`]: person, plan: [] }
    await page.route(`**${itemPath}`, (route) => route.fulfill({ json: envelope(detail) }))
    await page.route(`**${itemPath}/update`, (route) => {
      const body: unknown = route.request().postDataJSON()
      if (
        !body ||
        typeof body !== 'object' ||
        !('version' in body) ||
        body.version !== detail.version ||
        typeof body.version !== 'number'
      )
        throw new Error('更新版本不一致')
      detail = { ...detail, ...body, version: body.version + 1 }
      if (isRequirement && 'testOwnerUserIds' in body && Array.isArray(body.testOwnerUserIds)) {
        detail = {
          ...detail,
          testOwners: body.testOwnerUserIds.length ? [person] : [],
          testOwner: body.testOwnerUserIds.length ? person : null,
        }
      }
      if (`${role}OwnerUserId` in body) {
        const fields: Record<string, unknown> = { ...body }
        detail = { ...detail, [`${role}Owner`]: fields[`${role}OwnerUserId`] ? person : null }
      }
      return route.fulfill({ json: envelope(detail) })
    })

    await page.locator('.item-title').first().click()
    const sheet = page.getByRole('dialog', { name: isRequirement ? '需求详情' : 'Bug 详情' })
    const flow = sheet.getByRole('region', { name: isRequirement ? '需求流程' : 'Bug 流程' })
    await expect(flow.locator('[data-slot="user-avatar"] img')).toHaveAttribute('src', avatar)
    await page.screenshot({ path: testInfo.outputPath(`${kind}-detail.png`), animations: 'disabled' })
    if (isRequirement) {
      await sheet.getByRole('tab', { name: '评论', exact: true }).click()
      await expect(sheet.getByRole('heading', { name: /本轮实现摘要/ })).toBeVisible()
      await page.screenshot({ path: testInfo.outputPath('requirements-comments.png') })
      await sheet.getByRole('tab', { name: '基本信息', exact: true }).click()
      const completed = flow.getByRole('list', { name: '流程节点' }).getByRole('button').first()
      await completed.click()
      const foreground = await completed.evaluate((element) => {
        const sample = document.createElement('span')
        sample.style.color = 'var(--foreground)'
        element.append(sample)
        const color = getComputedStyle(sample).color
        sample.remove()
        return color
      })
      await expect(completed).toHaveCSS('color', foreground)
      await page.screenshot({ path: testInfo.outputPath('requirements-completed-node.png') })
      await flow.getByRole('list', { name: '流程节点' }).getByRole('button', { name: '测试，进行中' }).click()
    }

    const edit = sheet.getByRole('button', { name: isRequirement ? '编辑需求' : '编辑 Bug', exact: true })
    await edit.click()
    const form = page.getByRole('dialog', { name: isRequirement ? /^编辑需求/ : '编辑 Bug' })
    await form.getByRole('textbox', { name: /^标题/ }).fill('更新后的事项标题')
    await form.getByRole('button', { name: '保存', exact: true }).click()
    await expect(form).toBeHidden()
    await expect(sheet.getByRole('heading', { name: '更新后的事项标题', exact: true })).toBeVisible()
    await expect(edit).toBeFocused()

    if (isRequirement) {
      await flow.getByRole('button', { name: '移除 林辰' }).click()
      await expect(flow.getByRole('combobox', { name: '测试负责人' })).not.toContainText('林辰')
    } else {
      await flow.getByRole('button', { name: '修复负责人', exact: true }).click()
      await page.getByRole('option', { name: '清除选择' }).click()
      await expect(flow.getByText('未指定')).toBeVisible()
    }

    const timeline = flow.getByRole('list', { name: '流程节点' })
    const node = flow.getByRole('region', { name: '当前查看的节点' })
    const menu = node.getByRole('button', { name: '更多节点操作' })
    const existingTitle = isRequirement ? '质量验收' : '定位与修复'
    await menu.click()
    await page.getByRole('menuitem', { name: '编辑节点' }).click()
    const editNode = page.getByRole('dialog', { name: '编辑节点' })
    await editNode.getByRole('textbox', { name: /^节点名称/ }).fill(existingTitle)
    await editNode.getByRole('button', { name: '保存', exact: true }).click()
    await expect(editNode).toBeHidden()
    const activeStep = timeline.getByRole('button', { name: existingTitle + '，进行中' })
    await expect(activeStep).toHaveAttribute('aria-current', 'step')
    await expect(activeStep).toHaveAttribute('aria-pressed', 'true')

    await expect(flow.getByText('未排期', { exact: true })).toBeVisible()
    const newNodeTrigger = flow.getByRole('button', { name: '新增节点' })
    await newNodeTrigger.click()
    const addNode = page.getByRole('dialog', { name: '新增节点' })
    await addNode.getByRole('textbox', { name: /^节点名称/ }).fill('发布验收')
    await addNode.getByRole('button', { name: '保存', exact: true }).click()
    await expect(addNode).toBeHidden()
    await expect(node.getByRole('heading', { name: '发布验收', exact: true })).toBeVisible()
    const customStep = timeline.getByRole('button', { name: /^发布验收，/ })
    await expect(customStep).toHaveAttribute('aria-pressed', 'true')
    await expect(activeStep).toHaveAttribute('aria-current', 'step')
    await expect(activeStep).toHaveAttribute('aria-pressed', 'false')
    const nodeTitles = await timeline
      .locator('button')
      .evaluateAll((elements) => elements.map((element) => element.getAttribute('title')))
    expect(nodeTitles.indexOf('发布验收')).toBe(nodeTitles.indexOf(existingTitle) + 1)

    const newTaskTrigger = node.getByRole('button', { name: '新增任务' })
    for (const name of ['整理验收清单', '核对发布版本']) {
      await newTaskTrigger.click()
      const addTask = page.getByRole('dialog', { name: '新增任务' })
      await addTask.getByRole('textbox', { name: /^任务名称/ }).fill(name)
      await addTask.getByRole('button', { name: '保存', exact: true }).click()
      await expect(addTask).toBeHidden()
    }
    await expect(newTaskTrigger).toBeFocused()
    await expect(flow.getByText('未排期', { exact: true })).toBeVisible()
    const checklist = node.getByRole('checkbox', { name: '整理验收清单', exact: true })
    await checklist.click()
    await expect(checklist).toBeChecked()
    await expect(node.getByRole('heading', { name: '全部任务 (1/2)' })).toBeVisible()

    await node.getByRole('button', { name: '编辑任务 核对发布版本' }).click()
    const editTask = page.getByRole('dialog', { name: '编辑任务' })
    await editTask.getByLabel('开始日期').fill('2026-11-18')
    await editTask.getByLabel('结束日期').fill('2026-11-20')
    await editTask.getByRole('button', { name: '保存', exact: true }).click()
    await expect(editTask).toBeHidden()
    await expect(flow.getByText('3 天 · 2026-11-18 至 2026-11-20', { exact: true })).toBeVisible()
    await flow.scrollIntoViewIfNeeded()
    await page.screenshot({ path: testInfo.outputPath(kind + '-workflow.png'), animations: 'disabled' })

    if (testInfo.project.name === 'mobile') await activeStep.tap()
    else await activeStep.press('Enter')
    await expect(node.getByRole('heading', { name: existingTitle, exact: true })).toBeVisible()
    await expect(checklist).toHaveCount(0)
    await expect(node.getByRole('button', { name: isRequirement ? '测试通过' : '提交回归' })).toBeVisible()

    await page.reload()
    await expect(activeStep).toHaveAttribute('aria-pressed', 'true')
    await customStep.click()
    await expect(node.getByRole('heading', { name: '发布验收', exact: true })).toBeVisible()
    await expect(checklist).toBeChecked()
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      testInfo.project.name === 'mobile' ? 390 : 1440,
    )
  })
}
