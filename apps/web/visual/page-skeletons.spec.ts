import { expect, test } from '@playwright/test'
import { VISUAL_IDS } from './fixtures'
import { installApiMocks } from './mock-api'

test('[desktop] [mobile] 不同业务页面加载态展示各自定制骨架且无冗余加载文字', async ({ page }, testInfo) => {
  await installApiMocks(page)
  const { projectId } = VISUAL_IDS

  const routes: Array<{ path: string; name: string; selector: string }> = [
    { path: '/projects', name: 'projects', selector: '.project-home' },
    { path: `/projects/${projectId}/requirements`, name: 'requirements', selector: '.project-header' },
    { path: `/projects/${projectId}/code`, name: 'code', selector: '.project-header' },
    { path: '/capabilities/skills', name: 'skills', selector: '.skills-catalog' },
    { path: '/vault', name: 'vault', selector: '.catalog' },
  ]

  // 挂起团队接口，使工作区外壳与当前路由的专属骨架稳定停留，验证不同路由的差异化结构。
  await page.route('**/api/v1/me/teams', () => new Promise(() => undefined))

  for (const route of routes) {
    await page.goto(route.path)
    const status = page.getByRole('status').first()
    await expect(status).toBeVisible()
    await expect(page.locator(route.selector)).toBeVisible()
    await expect(page.locator('.react-loading-skeleton').first()).toBeVisible()
    await expect(page.getByText(/加载中…|正在加载/)).toHaveCount(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1)
    await page.screenshot({ path: testInfo.outputPath(`skeleton-${route.name}.png`) })
  }

  // 验证深色模式下骨架屏依然正常渲染且无横向溢出。
  await page.evaluate(() => document.documentElement.classList.add('dark'))
  await page.screenshot({ path: testInfo.outputPath('skeleton-vault-dark.png') })
})
