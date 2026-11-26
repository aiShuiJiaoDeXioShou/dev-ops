import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { installApiMocks } from './mock-api'
import { VISUAL_IDS } from './fixtures'

test('[desktop] [mobile] README 表格、图片、折叠区与锚点', async ({ page }, testInfo) => {
  await installApiMocks(page)
  const source = await readFile(new URL('../../../README.md', import.meta.url), 'utf8')
  await page.route('**/api/v1/projects/*/repositories/*/file?*', (route) =>
    route.fulfill({
      json: {
        success: true,
        code: 'OK',
        message: 'OK',
        requestId: 'markdown-preview',
        data: {
          path: 'README.md',
          content:
            source +
            '\n\n## 渲染验证\n\n```mermaid\ngraph LR\nA[开始] --> B[完成]\n```\n\n$x^2$\n\n> [!NOTE]\n> 提示内容',
          truncated: false,
        },
      },
    }),
  )
  await page.route('https://raw.githubusercontent.com/**', async (route) => {
    const path = new URL(route.request().url()).pathname.split('/').slice(4).join('/')
    const image = await readFile(new URL(`../../../${path}`, import.meta.url))
    await route.fulfill({ body: image, contentType: 'image/png' })
  })
  await page.route('https://img.shields.io/**', (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="20"><rect width="120" height="20" fill="gray"/><text x="5" y="15" fill="white">Badge</text></svg>',
    }),
  )
  await page.goto(`/projects/${VISUAL_IDS.projectId}/code`)
  const preview = page.locator('.code-markdown-preview')
  await expect(preview.getByRole('heading', { name: 'dev-ops', exact: true })).toBeVisible()
  await expect(preview.getByRole('table').first()).toBeVisible()
  const image = preview.getByRole('img', { name: '项目列表与活动晴雨表' })
  await image.scrollIntoViewIfNeeded()
  await expect
    .poll(() => image.evaluate((element) => element instanceof HTMLImageElement && element.naturalWidth > 0))
    .toBe(true)
  await page.screenshot({ path: testInfo.outputPath('readme-table.png') })
  await preview.locator('summary').first().click()
  const mobileImage = preview.getByRole('img', { name: '移动端项目晴雨表' })
  await mobileImage.scrollIntoViewIfNeeded()
  await expect
    .poll(() => mobileImage.evaluate((element) => element instanceof HTMLImageElement && element.naturalWidth > 0))
    .toBe(true)
  await preview.getByRole('link', { name: '核心能力', exact: true }).click()
  await expect(preview.getByRole('heading', { name: '核心能力', exact: true })).toBeInViewport()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('readme-anchor.png') })
  await expect(preview.locator('.markdown-diagram svg').last()).toBeVisible({ timeout: 30_000 })
  await expect(preview.locator('.katex')).toBeVisible()
  await expect(preview.locator('[data-alert="NOTE"]')).toContainText('提示内容')
  await preview.locator('.markdown-diagram').last().scrollIntoViewIfNeeded()
  await page.screenshot({ path: testInfo.outputPath('readme-extensions.png') })
  await page.evaluate(() => document.documentElement.classList.add('dark'))
  await image.scrollIntoViewIfNeeded()
  await page.screenshot({ path: testInfo.outputPath('readme-dark.png') })
})
