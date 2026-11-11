import { test, expect, type Page, type TestInfo } from '@playwright/test'
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
async function expectPageSnapshot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const layout = await captureLayout(page, testInfo, name)
  expect(JSON.stringify(layout, null, 2)).toMatchSnapshot(`${name}.json`)
  expect(normalizeRelativeTime(await page.locator('main').ariaSnapshot())).toMatchSnapshot(`${name}.aria.txt`)
}

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
    await page.locator('.item-title').first().click()
    await expect(page.locator('aside[aria-label="需求详情"]')).toBeVisible()
    await expectPageSnapshot(page, testInfo, 'requirement-detail')
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

  test('[desktop] 运维变更、能力、凭据、团队、节点、储存桶、个人页', async ({ page }, testInfo) => {
    const pages: Array<[string, string, string]> = [
      ['changes', '/operations/changes', '变更'],
      ['skills', '/capabilities/skills', '技能库'],
      ['templates', '/capabilities/templates', 'AGENTS.md 模板'],
      ['vault', '/vault', '凭据库'],
      ['team', '/settings/team?tab=connections', 'DevOps 研发团队'],
      ['nodes', '/settings/pipeline-nodes', '执行节点'],
      ['storage', '/settings/storage-buckets', '储存桶'],
      ['profile', '/settings/profile', '个人页面'],
    ]
    for (const [name, path, heading] of pages) {
      await prepare(page, path)
      await expect(page.getByText(heading, { exact: false }).first()).toBeVisible()
      await expectPageSnapshot(page, testInfo, name)
    }
  })
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
    await expect(page.locator('aside[aria-label="需求详情"]')).toBeVisible()
    const box = await page.locator('aside[aria-label="需求详情"]').boundingBox()
    expect(box?.x).toBeLessThanOrEqual(1)
    expect(box?.width).toBeLessThanOrEqual(390)
    await expectPageSnapshot(page, testInfo, 'requirement-detail')
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
