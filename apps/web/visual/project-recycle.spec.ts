import { expect, test } from '@playwright/test'
import { VISUAL_IDS } from './fixtures'
import { installApiMocks } from './mock-api'

function success(data: unknown) {
  return { success: true, code: 'OK', message: 'ok', requestId: 'recycle-test', data }
}

test('[desktop] [mobile] 项目删除确认、回收站清理与恢复', async ({ page }, testInfo) => {
  await installApiMocks(page)
  const { teamId, projectId, userId } = VISUAL_IDS
  const siblingId = '11111111-1111-4111-8111-111111111111'
  const date = '2026-11-17T03:00:00.000Z'
  const project = {
    id: projectId,
    teamId,
    name: '同名项目',
    description: '测试项目',
    status: 'active',
    version: 1,
    owner: { userId, name: '管理员', available: true, status: 'active' },
    counts: { openRequirements: 0, openBugs: 0 },
    createdAt: date,
    updatedAt: date,
  }
  const sibling = { ...project, id: siblingId }
  let deleted = false
  let cleanupStatus = 'none'
  await page.route(`**/api/v1/teams/${teamId}/projects*`, (route) =>
    route.fulfill({
      json: success({ items: deleted ? [sibling] : [project, sibling], total: deleted ? 1 : 2, page: 1, pageSize: 20 }),
    }),
  )
  await page.route(`**/api/v1/projects/${projectId}`, (route) =>
    route.fulfill({
      json: deleted
        ? { success: false, code: 'NOT_FOUND', message: '项目不存在', requestId: 'recycle-test' }
        : success(project),
    }),
  )
  await page.route(`**/api/v1/projects/${projectId}/remove`, (route) => {
    if (route.request().postDataJSON()?.password !== 'visual-project-password') {
      return route.fulfill({
        json: {
          success: false,
          code: 'PASSWORD_INVALID',
          message: '当前登录密码错误',
          requestId: 'recycle-test',
        },
      })
    }
    deleted = true
    project.version += 1
    return route.fulfill({ json: success({ id: projectId }) })
  })
  await page.route(`**/api/v1/teams/${teamId}/project-recycle-bin*`, (route) => {
    const items = deleted
      ? [{ id: projectId, name: project.name, version: project.version, deletedAt: date, cleanupStatus }]
      : []
    if (cleanupStatus === 'queued') cleanupStatus = 'succeeded'
    return route.fulfill({ json: success({ items, total: items.length, page: 1, pageSize: 20 }) })
  })
  await page.route(`**/api/v1/projects/${projectId}/cleanup-files`, (route) => {
    expect(route.request().postDataJSON()).toEqual({ version: 2, password: 'visual-project-password' })
    cleanupStatus = 'queued'
    return route.fulfill({ json: success({ id: siblingId, cleanupStatus }) })
  })
  await page.route(`**/api/v1/projects/${projectId}/restore`, (route) => {
    expect(route.request().postDataJSON()).toEqual({ version: 2 })
    deleted = false
    return route.fulfill({ json: success({ id: projectId }) })
  })

  await page.goto('/projects')
  await page.getByRole('button', { name: '同名项目项目设置' }).first().click()
  const settings = page.getByRole('dialog', { name: '项目设置' })
  const remove = settings.getByRole('button', { name: '移入回收站' })
  await remove.click()
  const confirmation = page.getByRole('alertdialog', { name: '移入回收站' })
  await expect(confirmation.getByText(`项目 ID ${projectId}`)).toBeVisible()
  await expect(confirmation.getByRole('button', { name: '取消' })).toBeFocused()
  await page.screenshot({ path: testInfo.outputPath('project-remove.png') })
  await page.keyboard.press('Escape')
  await expect(remove).toBeFocused()
  await remove.click()
  const password = confirmation.getByLabel('当前登录密码')
  await password.fill('visual-wrong-password')
  const confirmRemove = confirmation.getByRole('button', { name: '确认移入回收站' })
  await confirmRemove.click()
  await expect(confirmation.getByRole('alert')).toHaveText('登录密码错误，请重试。')
  await expect(password).toHaveValue('')
  await password.fill('visual-project-password')
  await confirmRemove.click()
  await expect(settings).toBeHidden()
  await expect(page.getByRole('button', { name: '同名项目项目设置' })).toHaveCount(1)

  await page.goto(`/projects/${projectId}/requirements`)
  await expect(page.getByRole('heading', { name: '项目加载失败' })).toBeVisible()
  await page.goto('/projects')

  const recycleEntry = page.getByRole('button', { name: '回收站', exact: true })
  await recycleEntry.click()
  const recycle = page.getByRole('dialog', { name: '项目回收站' })
  await expect(recycle.getByText(`项目 ID ${projectId}`)).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('project-recycle.png') })
  await recycle.getByRole('button', { name: '清理项目文件' }).click()
  const cleanup = page.getByRole('alertdialog', { name: '清理项目文件' })
  await cleanup.getByLabel('当前登录密码').fill('visual-project-password')
  await cleanup.getByRole('button', { name: '确认清理项目文件' }).click()
  await expect(recycle.getByRole('button', { name: '恢复项目' })).toBeDisabled()
  await expect(recycle.getByText(/文件已清理/)).toBeVisible()

  await recycle.getByRole('button', { name: '恢复项目' }).click()
  await page.getByRole('alertdialog', { name: '恢复项目' }).getByRole('button', { name: '确认恢复项目' }).click()
  await expect(recycle.getByText('回收站没有项目。')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(recycleEntry).toBeFocused()
  await expect(page.getByRole('button', { name: '同名项目项目设置' })).toHaveCount(2)
})
