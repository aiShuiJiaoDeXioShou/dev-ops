import { expect, test } from '@playwright/test'
import { VISUAL_IDS } from './fixtures'
import { installApiMocks } from './mock-api'

test('[desktop] [mobile] 需求和 Bug 评论展示作者头像，缺失或损坏时保留首字', async ({ page }, testInfo) => {
  await installApiMocks(page)
  const projectPath = `/projects/${VISUAL_IDS.projectId}`
  await page.goto(projectPath + '/requirements')
  const image = await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 160
    canvas.height = 160
    const context = canvas.getContext('2d')
    if (!context) throw new Error('无法生成测试头像')
    context.fillStyle = 'seagreen'
    context.fillRect(0, 0, 160, 160)
    context.fillStyle = 'white'
    context.fillRect(35, 35, 90, 90)
    return canvas.toDataURL('image/jpeg')
  })
  await page.route(/\/api\/v1\/(requirements|bugs)\/[^/]+\/comments(?:\?|$)/, (route) =>
    route.fulfill({
      json: {
        success: true,
        code: 'OK',
        message: 'OK',
        requestId: 'visual-comment-avatar',
        data: {
          items: [
            { authorName: '杨腾', authorImage: image, bodyMarkdown: '请补充异常路径。' },
            { authorName: '周舟', authorImage: 'data:image/jpeg;base64,YQ==', bodyMarkdown: '图片加载失败。' },
            { authorName: '陈辰', bodyMarkdown: '账号还未上传头像。' },
          ].map((item, index) => ({
            ...item,
            id: `11111111-1111-4111-8111-11111111111${index}`,
            authorUserId: `22222222-2222-4222-8222-22222222222${index}`,
            createdAt: '2026-11-11T04:31:00.000Z',
          })),
          page: 1,
          pageSize: 20,
          total: 3,
        },
      },
    }),
  )

  await page.route(/\/api\/v1\/bugs\/[a-z0-9-]+$/i, (route) =>
    route.fulfill({
      json: {
        success: true,
        code: 'OK',
        message: 'OK',
        requestId: 'visual-bug-avatar',
        data: {
          id: new URL(route.request().url()).pathname.split('/').pop(),
          projectId: VISUAL_IDS.projectId,
          teamId: VISUAL_IDS.teamId,
          number: 9,
          title: '缺陷头像验收',
          status: 'pending',
          fixOwner: null,
          regressionOwner: null,
          version: 1,
          updatedAt: '2026-11-11T04:31:00.000Z',
          phenomenon: '缺陷详情展示成员头像',
          expectedBehavior: '显示账号上传的头像',
          reproduction: null,
          reproductionUnknown: true,
          evidenceText: null,
          evidenceUrl: null,
          createdByUserId: VISUAL_IDS.userId,
          createdAt: '2026-11-11T04:31:00.000Z',
          collaborators: [{ userId: VISUAL_IDS.userId, name: '杨腾', image, status: 'active', available: true }],
          attachments: [],
          linkedRequirements: [],
          linkedCodeReferences: [],
          regressions: [],
        },
      },
    }),
  )

  for (const [path, title] of [
    ['requirements', '需求详情'],
    ['bugs', 'Bug 详情'],
  ]) {
    await page.goto(`${projectPath}/${path}`)
    await page.locator('.item-title').first().click()
    const detail = page.getByRole('dialog', { name: title })
    const comments = detail.getByRole('tabpanel', { name: '评论' })
    const withImage = comments.getByRole('listitem').filter({ hasText: '杨腾' })
    const uploaded = withImage.locator('[data-slot="user-avatar"] img')
    await expect(uploaded).toBeVisible()
    await expect(uploaded).toHaveAttribute('src', image)
    await expect(
      comments.getByRole('listitem').filter({ hasText: '周舟' }).locator('[data-slot="user-avatar"]'),
    ).toHaveText('周')
    await expect(
      comments.getByRole('listitem').filter({ hasText: '陈辰' }).locator('[data-slot="user-avatar"]'),
    ).toHaveText('陈')
    if (path === 'bugs') {
      await expect(detail.getByRole('list', { name: '协作人员' }).locator('img')).toHaveAttribute('src', image)
    }
    await uploaded.scrollIntoViewIfNeeded()
    await page.screenshot({ path: testInfo.outputPath(`${path}-comment-avatars.png`) })
  }
})
