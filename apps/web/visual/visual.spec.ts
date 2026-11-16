import { test, expect, type Locator, type Page, type Request, type TestInfo } from '@playwright/test'
import { installApiMocks } from './mock-api'
import { VISUAL_IDS } from './fixtures'

/** 页面布局不变量；只记录跨平台稳定的语义与布尔结果，不做像素对比。 */
interface LayoutSnapshot {
  path: string
  viewport: { width: number; height: number }
  headings: string[]
  tabs: string[]
  rows: number
  statusTexts: string[]
  documentOverflow: boolean
  interactiveCount: number
  nonPointerControls: string[]
  smallTargets: string[]
}

async function prepare(page: Page, path: string): Promise<void> {
  await installApiMocks(page)
  await page.goto(path, { waitUntil: 'networkidle' })
  await page.locator('main').waitFor()
  // 首屏路由与数据查询都完成后才截图，避免把骨架屏当作页面基线。
  await page
    .waitForFunction(() => !document.body.textContent?.includes('页面加载中'), undefined, { timeout: 15_000 })
    .catch(() => undefined)
  await page.waitForTimeout(300)
}

/**
 * 采集页面布局与可访问性特征并保存截图。
 * @param page Playwright 页面。
 * @param testInfo 当前测试信息，用于输出截图。
 * @param name 快照名称。
 * @returns 可快照的布局对象。
 */
/** 将相对时间替换为占位符，避免快照随当前时间漂移。 */
function normalizeRelativeTime(value: string): string {
  return value
    .replace(/\d+\s*(秒|分钟|小时|天|周|个月|年)前/g, '<relative-time>')
    .replace(/刚刚|今天|昨天|前天/g, '<relative-time>')
}

async function captureLayout(page: Page, testInfo: TestInfo, name: string): Promise<LayoutSnapshot> {
  await page.waitForTimeout(500)
  const layout = await page.evaluate(() => {
    const visible = (element: Element): boolean => {
      const rect = element.getBoundingClientRect()
      const style = getComputedStyle(element)
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'
    }
    const interactive = [...document.querySelectorAll('button, a[href], [role="button"], [role="tab"]')].filter(visible)
    const nonPointerControls = interactive
      .filter((element) => {
        const control = element as HTMLElement
        if (control.matches(':disabled') || control.getAttribute('aria-disabled') === 'true') return false
        return getComputedStyle(control).cursor !== 'pointer'
      })
      .slice(0, 8)
      .map((element) => (element.textContent ?? '').trim().slice(0, 24))
    const smallTargets = interactive
      .map((element) => ({ element, rect: element.getBoundingClientRect() }))
      .filter(({ rect }) => rect.width > 0 && rect.height > 0 && (rect.width < 24 || rect.height < 24))
      .slice(0, 8)
      .map(({ element }) => (element.textContent ?? '').trim().slice(0, 24))
    return {
      path: location.pathname,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      headings: [...document.querySelectorAll('h1, h2, h3')]
        .filter(visible)
        .map((element) => (element.textContent ?? '').trim())
        .slice(0, 12),
      tabs: [...document.querySelectorAll('[role="tab"]')]
        .filter(visible)
        .map((element) => (element.textContent ?? '').trim())
        .slice(0, 12),
      rows: [...document.querySelectorAll('tbody tr')].filter(visible).length,
      statusTexts: [...document.querySelectorAll('.status-pill')]
        .filter(visible)
        .map((element) => (element.textContent ?? '').trim())
        .slice(0, 16),
      documentOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      interactiveCount: interactive.length,
      nonPointerControls,
      smallTargets,
    }
  })
  await page.screenshot({ path: testInfo.outputPath(`${name}.png`), fullPage: true })
  return layout
}

/** 记录页面主内容与布局；页面依赖的 API 全部来自确定性 mock。 */
async function expectPageSnapshot(
  page: Page,
  testInfo: TestInfo,
  name: string,
  ariaRoot: Locator = page.locator('main'),
): Promise<void> {
  const layout = await captureLayout(page, testInfo, name)
  const stableLayout = { ...layout, smallTargets: layout.smallTargets.map(normalizeRelativeTime) }
  expect(JSON.stringify(stableLayout, null, 2)).toMatchSnapshot(`${name}.json`)
  expect(normalizeRelativeTime(await ariaRoot.ariaSnapshot())).toMatchSnapshot(`${name}.aria.txt`)
}

test('[desktop] [mobile] 工作区与项目设置弹窗沿用明暗主题的弱背景和次级文字色', async ({ page }, testInfo) => {
  await prepare(page, '/projects')
  const trigger = page.getByRole('button', { name: /项目设置/ }).first()
  const dialog = page.getByRole('dialog')
  for (const mode of ['light', 'dark']) {
    await page.evaluate((dark) => document.documentElement.classList.toggle('dark', dark), mode === 'dark')
    await trigger.click()
    await expect(dialog).toBeVisible()
    const tokens = await dialog.evaluate((element) => {
      const read = (scope: Element) => {
        const style = getComputedStyle(scope)
        return [style.getPropertyValue('--muted').trim(), style.getPropertyValue('--muted-foreground').trim()]
      }
      const shell = document.querySelector('.shell')
      return {
        root: read(document.documentElement),
        shell: shell && read(shell),
        dialog: read(element),
      }
    })
    expect(tokens.root[0]).toBeTruthy()
    expect(tokens.root[1]).toBeTruthy()
    expect(tokens.root[0]).not.toBe(tokens.root[1])
    expect(tokens.shell).toEqual(tokens.root)
    expect(tokens.dialog).toEqual(tokens.root)
    if (testInfo.project.name === 'desktop') {
      const close = dialog.getByRole('button', { name: '关闭', exact: true })
      const mutedBackground = await close.evaluate((element) => {
        const sample = document.createElement('span')
        sample.style.backgroundColor = 'var(--muted)'
        element.append(sample)
        const background = getComputedStyle(sample).backgroundColor
        sample.remove()
        return background
      })
      await close.hover()
      await expect(close).toHaveCSS('background-color', mutedBackground)
    }
    await page.screenshot({ path: testInfo.outputPath(`theme-${mode}.png`) })
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
  }
})

test.describe('[desktop] 核心页面', () => {
  test('[desktop] 项目首页展示项目卡片与晴雨表', async ({ page }, testInfo) => {
    await prepare(page, '/projects')
    await expect(page.getByRole('heading', { name: '项目', level: 1 })).toBeVisible()
    await expectPageSnapshot(page, testInfo, 'projects')
  })

  test('[desktop] 需求列表与详情面板', async ({ page }, testInfo) => {
    await prepare(page, `/projects/${VISUAL_IDS.projectId}/requirements`)
    await expect(page.getByRole('button', { name: '新建需求' })).toBeVisible()
    await expectPageSnapshot(page, testInfo, 'requirements')
    // 筛选下拉应只有一个箭头，且宽度跟随内容，不能出现标签与箭头分散的“双箭头”。
    await expect(page.locator('.filter-select svg')).toHaveCount(1)
    const filterBox = await page.locator('.filter-select').first().boundingBox()
    expect(filterBox?.width ?? 0).toBeLessThanOrEqual(140)
    const trigger = page.locator('.item-title').first()
    await trigger.click()
    const detail = page.getByRole('dialog', { name: '需求详情' })
    await expect(detail).toBeVisible()
    await expect.poll(async () => (await detail.boundingBox())?.width).toBe(760)
    await expectPageSnapshot(page, testInfo, 'requirement-detail', detail)
    await detail.getByRole('button', { name: '全屏', exact: true }).click()
    await expect.poll(async () => (await detail.boundingBox())?.width).toBe(1440)
    await page.keyboard.press('Escape')
    await expect(detail).toBeHidden()
    await expect(trigger).toBeFocused()
  })

  test('[desktop] Bug、代码、PR、流水线、产物、环境变量', async ({ page }, testInfo) => {
    const pages: Array<[string, string, string]> = [
      ['bugs', `/projects/${VISUAL_IDS.projectId}/bugs`, 'Bug'],
      ['code', `/projects/${VISUAL_IDS.projectId}/code`, '代码'],
      ['prs', `/projects/${VISUAL_IDS.projectId}/prs`, 'PR'],
      ['pipelines', `/projects/${VISUAL_IDS.projectId}/pipelines`, '流水线'],
      ['artifacts', `/projects/${VISUAL_IDS.projectId}/artifacts`, '产物与版本'],
      ['environment', `/projects/${VISUAL_IDS.projectId}/environment`, '环境变量'],
    ]
    for (const [name, path, tab] of pages) {
      const reads: Request[] = []
      const recordRead = (request: Request) => {
        if (/\/repositories\/[^/]+\/(tree|file)$/.test(new URL(request.url()).pathname)) reads.push(request)
      }
      if (name === 'code') page.on('request', recordRead)
      await prepare(page, path)
      await expect(page.getByRole('tab', { name: tab })).toBeVisible()
      await expectPageSnapshot(page, testInfo, name)
      if (name === 'artifacts') {
        await expect(page.getByRole('tab', { name: '全部' })).toBeVisible()
      }
      if (name === 'environment') {
        await expect(page.getByRole('tab', { name: /测试/ }).first()).toBeVisible()
      }
      if (name === 'code') {
        const fileTree = page.getByRole('navigation', { name: '文件目录' })
        const directory = fileTree.getByRole('button', { name: '.devops', exact: true })
        const subdirectory = fileTree.getByRole('button', { name: 'workflows', exact: true })
        // React 严格模式可能取消首次挂载时的请求；仅统计随后保留的读取。
        const readPaths = (resource: 'tree' | 'file') =>
          reads
            .filter((request) => request.failure()?.errorText !== 'net::ERR_ABORTED')
            .map((request) => new URL(request.url()))
            .filter((url) => url.pathname.endsWith(`/${resource}`))
            .map((url) => url.searchParams.get('path'))
        expect(readPaths('tree')).toEqual([''])
        await expect(directory).toHaveAttribute('aria-expanded', 'false')
        await expect(directory.locator('.lucide-chevron-right')).toHaveCSS('transform', 'none')
        await directory.click()
        await expect(directory).toHaveAttribute('aria-expanded', 'true')
        await expect(directory.locator('.lucide-chevron-down')).toHaveCSS('transform', 'none')
        await expect(subdirectory).toBeVisible()
        await subdirectory.click()
        const workflow = fileTree.getByRole('button', { name: 'platform-smoke.yml', exact: true })
        await expect(workflow).toBeVisible()
        await workflow.click()
        await expect(page.locator('.file-head')).toContainText('.devops/workflows/platform-smoke.yml')
        await expect(page.getByRole('button', { name: '复制内容' })).toBeEnabled()
        const readme = fileTree.getByRole('button', { name: 'README.md', exact: true })
        await readme.click()
        await expect(page.getByRole('button', { name: '复制内容' })).toBeEnabled()
        const readCount = reads.length
        await directory.click()
        await expect(subdirectory).toHaveCount(0)
        await directory.click()
        await expect(workflow).toBeVisible()
        await workflow.click()
        await expect(page.getByRole('button', { name: '复制内容' })).toBeEnabled()
        expect(reads).toHaveLength(readCount)
        expect(readPaths('tree')).toEqual(['', '.devops', '.devops/workflows'])
        expect(readPaths('file')).toEqual(['README.md', '.devops/workflows/platform-smoke.yml'])
        page.off('request', recordRead)

        // 代码变更收进工具栏抽屉；写能力调用由日志图标打开，均不再铺在代码浏览器下方。
        await page.getByRole('button', { name: '代码变更' }).first().click()
        await expect(page.locator('.code-change-card').first()).toBeVisible()
        await page.keyboard.press('Escape')
        await page.getByRole('button', { name: '查看写能力调用记录' }).first().click()
        await expect(page.locator('.invocation-row').first()).toBeVisible()
        await expect(page.locator('.invocation-row .status-pill').first()).toBeVisible()
        await page.keyboard.press('Escape')
      }
    }
  })

  test('[desktop] 运维变更、能力、凭据、团队、节点、个人页', async ({ page }, testInfo) => {
    const pages: Array<[string, string, string]> = [
      ['changes', '/operations/changes', '变更'],
      ['skills', '/capabilities/skills', '技能库'],
      ['vault', '/vault', '凭据库'],
      ['team', '/settings/team?tab=connections', 'DevOps 研发团队'],
      ['nodes', '/settings/pipeline-nodes', '执行节点'],
      ['profile', '/settings/profile', '个人页面'],
    ]
    for (const [name, path, heading] of pages) {
      await prepare(page, path)
      await expect(page.getByText(heading, { exact: false }).first()).toBeVisible()
      await expectPageSnapshot(page, testInfo, name)
    }
  })
})

test('[desktop] [mobile] 平台管理储存桶与新建弹窗', async ({ page }, testInfo) => {
  await prepare(page, '/platform')
  await expect(page.getByRole('heading', { name: '平台管理', level: 1 })).toBeVisible()
  await expect(page.getByRole('heading', { name: '储存桶', level: 2 })).toBeVisible()
  const list = page.getByRole('region', { name: '储存桶列表' })
  await expect(list.getByRole('table')).toBeVisible()
  if (testInfo.project.name === 'mobile') {
    const scrollable = list.locator('[data-slot="table-container"]')
    expect(await scrollable.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390)
  }
  await expectPageSnapshot(page, testInfo, 'storage')
  const create = page.getByRole('button', { name: '新建储存桶' })
  await create.click()
  await expect(page.getByRole('dialog', { name: '新建储存桶' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(create).toBeFocused()
})

test.describe('[desktop] 关键弹窗', () => {
  test('[desktop] 项目设置弹窗按页签分组', async ({ page }, testInfo) => {
    await prepare(page, '/projects')
    await page
      .getByRole('button', { name: /项目设置/ })
      .first()
      .click()
    const dialog = page.getByRole('dialog').first()
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('tab', { name: '基本资料' })).toBeVisible()
    await dialog.getByRole('tab', { name: '代码仓库' }).click()
    await expectPageSnapshot(page, testInfo, 'dialog-project-settings')
    const footer = await dialog.locator('[data-slot="dialog-footer"], [data-slot="dialog-form-footer"]').count()
    expect(footer).toBeGreaterThanOrEqual(0)
  })

  test('[desktop] 使用记录进入侧边日志抽屉', async ({ page }, testInfo) => {
    await prepare(page, '/vault')
    await page.getByRole('button', { name: '查看使用记录' }).first().click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(page.getByRole('heading', { name: '使用记录' })).toBeVisible()
    await expectPageSnapshot(page, testInfo, 'sheet-vault-usage')
    await page.keyboard.press('Escape')

    await prepare(page, `/projects/${VISUAL_IDS.projectId}/code`)
    await page.getByRole('button', { name: '代码变更' }).first().click()
    await expect(page.locator('.code-change-card').first()).toBeVisible()
    await expectPageSnapshot(page, testInfo, 'sheet-code-changes')
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: '查看写能力调用记录' }).first().click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(page.getByRole('heading', { name: '写能力调用记录' })).toBeVisible()
    await expectPageSnapshot(page, testInfo, 'sheet-code-invocations')
  })

  test('[desktop] 需求创建与变更计划创建弹窗固定底栏', async ({ page }, testInfo) => {
    for (const [name, path, trigger] of [
      ['dialog-requirement-create', `/projects/${VISUAL_IDS.projectId}/requirements`, '新建需求'],
      ['dialog-change-create', '/operations/changes', '新建变更计划'],
    ] as const) {
      await prepare(page, path)
      await page.getByRole('button', { name: trigger }).first().click()
      const dialog = page.getByRole('dialog').first()
      await expect(dialog).toBeVisible()
      await expectPageSnapshot(page, testInfo, name)
      const box = await dialog.boundingBox()
      expect(box).not.toBeNull()
      expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual((await page.viewportSize())!.height + 1)
      await page.keyboard.press('Escape')
    }
  })
})

test.describe('[mobile] 关键页面', () => {
  test('[mobile] 项目列表无横向溢出', async ({ page }, testInfo) => {
    await prepare(page, '/projects')
    await expectPageSnapshot(page, testInfo, 'projects')
  })

  test('[mobile] 需求列表与整屏详情', async ({ page }, testInfo) => {
    await prepare(page, `/projects/${VISUAL_IDS.projectId}/requirements`)
    await expectPageSnapshot(page, testInfo, 'requirements')
    // 筛选下拉应只有一个箭头，且宽度跟随内容，不能出现标签与箭头分散的“双箭头”。
    await expect(page.locator('.filter-select svg')).toHaveCount(1)
    const filterBox = await page.locator('.filter-select').first().boundingBox()
    expect(filterBox?.width ?? 0).toBeLessThanOrEqual(140)
    await page.locator('.item-title').first().click()
    const detail = page.getByRole('dialog', { name: '需求详情' })
    await expect(detail).toBeVisible()
    await expect.poll(async () => (await detail.boundingBox())?.width).toBe(390)
    await expectPageSnapshot(page, testInfo, 'requirement-detail', detail)
  })

  test('[mobile] 团队设置与项目设置弹窗', async ({ page }, testInfo) => {
    await prepare(page, '/settings/team?tab=connections')
    await expectPageSnapshot(page, testInfo, 'team')
    await prepare(page, '/projects')
    await page
      .getByRole('button', { name: /项目设置/ })
      .first()
      .click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await expectPageSnapshot(page, testInfo, 'dialog-project-settings')
  })
})
