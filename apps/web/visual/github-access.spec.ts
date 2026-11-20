import { expect, test } from '@playwright/test'
import { installApiMocks } from './mock-api'
import { VISUAL_IDS } from './fixtures'

const repositoryAction = '**/api/v1/projects/*/repositories/*/github-action'
const projectPath = `/projects/${VISUAL_IDS.projectId}`

function envelope(data: unknown) {
  return { success: true, code: 'OK', message: 'ok', requestId: 'visual-github', data }
}

function denied(code: 'GITHUB_ACCOUNT_REQUIRED' | 'GITHUB_REPOSITORY_FORBIDDEN') {
  return { success: false, code, message: '需要检查 GitHub 权限', requestId: 'visual-github' }
}

test('[desktop] [mobile] 已接入的 GitHub 代码照常可读，写操作绑定后恢复并重新检查', async ({
  page,
  baseURL,
}, testInfo) => {
  await installApiMocks(page)
  let isBound = false
  let canWrite = false
  let checks = 0
  let initialEdit: unknown
  const editUrl = 'https://github.com/visual-example/repo/edit/main/README.md'
  const authorizationUrl = 'https://github.com/login/oauth/authorize?fixture=devops-visual'
  await page.route(repositoryAction, async (route) => {
    const edit: unknown = route.request().postDataJSON()
    if (checks === 0) initialEdit = edit
    else expect(edit).toEqual(initialEdit)
    checks += 1
    if (!isBound) return route.fulfill({ json: denied('GITHUB_ACCOUNT_REQUIRED') })
    if (!canWrite) return route.fulfill({ json: denied('GITHUB_REPOSITORY_FORBIDDEN') })
    return route.fulfill({ json: envelope({ url: editUrl }) })
  })
  await page.route('**/api/v1/me/github-account/authorize', async (route) => {
    expect(route.request().postDataJSON()).toEqual({ returnTo: `${projectPath}/code` })
    return route.fulfill({ json: envelope({ authorizationUrl }) })
  })
  await page.route(authorizationUrl, async (route) => {
    isBound = true
    return route.fulfill({
      status: 302,
      headers: { location: new URL(`${projectPath}/code?githubAccount=connected`, baseURL).href },
    })
  })
  await page.route(editUrl, (route) => route.fulfill({ body: 'GitHub 编辑页面', contentType: 'text/plain' }))

  await page.goto(`${projectPath}/code`)
  const edit = page.getByRole('button', { name: '编辑代码' })
  await expect(edit).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('navigation', { name: '文件目录' })).toBeVisible()
  expect(checks).toBe(0)
  await page.screenshot({ path: testInfo.outputPath('github-code.png') })
  await edit.click()
  const binding = page.getByRole('dialog', { name: '需要绑定 GitHub 账号' })
  await expect(binding).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('github-binding-required.png') })
  await page.keyboard.press('Escape')
  await expect(edit).toBeFocused()
  await edit.click()
  await binding.getByRole('button', { name: '绑定 GitHub 账号' }).click()
  const forbidden = page.getByRole('dialog', { name: 'GitHub 仓库权限不足' })
  await expect(forbidden.getByText(/仓库管理员申请/)).toBeVisible()
  expect(checks).toBe(3)
  await page.screenshot({ path: testInfo.outputPath('github-permission-denied.png') })
  canWrite = true
  await forbidden.getByRole('button', { name: '重新检查' }).click()
  await expect(page).toHaveURL(editUrl)
  expect(checks).toBe(4)
})

test('[desktop] [mobile] PR 可浏览，创建入口通过校验后跳转 GitHub', async ({ page }, testInfo) => {
  await installApiMocks(page)
  const teamFields = { iconText: null, description: null, version: 1, status: 'active' }
  await page.route('**/api/v1/me/teams', (route) =>
    route.fulfill({
      json: envelope({
        isPlatformAdmin: false,
        teams: [
          { ...teamFields, id: '1adc494d-c164-512c-8ca3-d80d11dae8ae', name: '其他团队', role: 'viewer' },
          { ...teamFields, id: VISUAL_IDS.teamId, name: '项目团队', role: 'developer' },
        ],
      }),
    }),
  )
  let checks = 0
  const compareUrl = 'https://github.com/visual-example/repo/compare'
  await page.route(repositoryAction, async (route) => {
    checks += 1
    expect(route.request().postDataJSON()).toEqual({ action: 'create_pull_request' })
    return route.fulfill({ json: envelope({ url: compareUrl }) })
  })
  await page.route(compareUrl, (route) => route.fulfill({ body: 'GitHub 创建 PR 页面', contentType: 'text/plain' }))
  await page.goto(`${projectPath}/prs`)
  const create = page.getByRole('button', { name: '创建 PR' })
  await expect(create).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('button', { name: /平台体验审计与自举迭代/ })).toBeVisible()
  expect(checks).toBe(0)
  await page.screenshot({ path: testInfo.outputPath('github-pr.png') })
  await create.click()
  await expect(page).toHaveURL(compareUrl)
  expect(checks).toBe(1)
})

test('[desktop] [mobile] 个人页面展示 GitHub 绑定与更换入口', async ({ page }, testInfo) => {
  await installApiMocks(page)
  await page.goto('/settings/profile')
  const bind = page.getByRole('button', { name: '绑定 GitHub 账号' })
  await expect(bind).toBeEnabled({ timeout: 15_000 })
  await page.screenshot({ path: testInfo.outputPath('github-profile.png') })

  await page.route('**/api/v1/me/github-account', (route) =>
    route.fulfill({ json: envelope({ login: 'visual-developer', enabled: true }) }),
  )
  await page.reload()
  await expect(page.getByRole('button', { name: '更换 GitHub 账号' })).toBeEnabled()
  await expect(page.getByText('已绑定 @visual-developer')).toBeVisible()
})

test('[desktop] [mobile] 从团队设置选择已有 GitHub App 安装', async ({ page }, testInfo) => {
  await installApiMocks(page)
  await page.route('**/api/v1/teams/*/github-installations/discover', (route) =>
    route.fulfill({
      json: envelope([
        { id: 13, login: 'personal' },
        { id: 14, login: 'organization' },
      ]),
    }),
  )

  await page.goto('/settings/team?tab=connections')
  const trigger = page.getByRole('button', { name: '添加 GitHub 连接' })
  await trigger.click()
  const dialog = page.getByRole('dialog', { name: '添加 GitHub 连接' })
  const select = dialog.getByLabel('GitHub App 安装')
  const submit = dialog.getByRole('button', { name: '绑定并同步' })
  await expect(select).toBeVisible()
  await expect(submit).toBeDisabled()
  await select.selectOption('14')
  await expect(submit).toBeEnabled()
  await expect(dialog.getByRole('button', { name: '新建 GitHub App 安装' })).toBeVisible()
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('github-existing-installation.png') })
  await page.keyboard.press('Escape')
  await expect(dialog).not.toBeVisible()
  await expect(trigger).toBeFocused()
})
