import { expect, test } from '@playwright/test'
import { VISUAL_IDS } from './fixtures'
import { installApiMocks } from './mock-api'

const longTitle = 'fix(code): 修复提交记录中无法自然断行的分支名 ' + 'long-branch-name'.repeat(8)
const longPath = 'apps/web/src/features/code/' + 'long-filename'.repeat(10) + '.tsx'
const commit = {
  sha: 'a6ff3b6dbeef',
  title: longTitle,
  authorName: '测试用户',
  committedAt: '2026-11-19T16:10:00Z',
  lastCheckedAt: '2026-11-20T01:00:00Z',
  url: null,
}

test('[desktop][mobile] 提交记录抽屉按日期分组且长内容不溢出', async ({ page }, testInfo) => {
  await installApiMocks(page)
  await page.route('**/repositories/*/commits?*', (route) =>
    route.fulfill({
      json: {
        success: true,
        code: 'OK',
        message: 'OK',
        requestId: 'visual-commits',
        data: {
          items: [
            commit,
            { ...commit, sha: '125fabcd', title: 'feat(code): 支持代码预览', committedAt: '2026-11-19T16:00:00Z' },
            { ...commit, sha: '150ed9c0', title: 'fix(web): 修复代码页布局', committedAt: '2026-11-19T15:59:00Z' },
          ],
          page: 1,
          pageSize: 30,
          total: 3,
        },
      },
    }),
  )
  await page.route(`**/repositories/*/commits/${commit.sha}`, (route) =>
    route.fulfill({
      json: {
        success: true,
        code: 'OK',
        message: 'OK',
        requestId: 'visual-commit',
        data: {
          ...commit,
          files: [{ path: longPath, status: 'modified', additions: 3, deletions: 1 }],
          filesTruncated: false,
          filesUnsupported: false,
        },
      },
    }),
  )

  await page.goto(`/projects/${VISUAL_IDS.projectId}/code`)
  const trigger = page.getByRole('button', { name: '提交记录', exact: true })
  await trigger.click()
  const sheet = page.getByRole('dialog', { name: '提交记录' })
  await expect(sheet.getByRole('heading', { level: 3 })).toHaveText(['2026/11/20', '2026/11/19'])
  const entry = sheet.getByRole('button', { name: /a6ff3b6d/ })
  await entry.focus()
  await page.keyboard.press('Enter')
  await expect(entry).toHaveAttribute('aria-expanded', 'true')
  await expect(sheet.getByText(longPath)).toBeVisible()

  await expect
    .poll(() =>
      sheet.evaluate((element) => {
        const { right, top, bottom } = element.getBoundingClientRect()
        const body = element.querySelector('.commit-history-body')
        return {
          fillsHeight: top === 0 && bottom === window.innerHeight,
          rightAligned: Math.abs(right - window.innerWidth) < 1,
          hasHorizontalOverflow: body ? body.scrollWidth > body.clientWidth : true,
        }
      }),
    )
    .toEqual({ fillsHeight: true, rightAligned: true, hasHorizontalOverflow: false })
  await page.screenshot({ path: testInfo.outputPath('commit-history.png') })

  if (testInfo.project.name === 'desktop') {
    const lightBackground = await sheet.evaluate((element) => getComputedStyle(element).backgroundColor)
    await page.locator('html').evaluate((element) => element.classList.add('dark'))
    await expect(sheet).not.toHaveCSS('background-color', lightBackground)
    await page.screenshot({ path: testInfo.outputPath('commit-history-dark.png') })
  }
  await page.keyboard.press('Escape')
  await expect(sheet).toBeHidden()
  await expect(trigger).toBeFocused()
})
