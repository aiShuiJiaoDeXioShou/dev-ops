import { expect, test } from '@playwright/test'
import { installApiMocks } from './mock-api'

test('[desktop] [mobile] 个人资料可上传头像，密码和 Token 各有独立入口', async ({ page }, testInfo) => {
  await installApiMocks(page)
  const user: { id: string; name: string; email: string; image: string | null } = {
    id: 'profile-user',
    name: '测试用户',
    email: 'profile@example.test',
    image: null,
  }
  let shouldReject = true
  await page.route('**/api/v1/auth/get-session', (route) =>
    route.fulfill({ json: { user, session: { id: 'profile-session', expiresAt: '2030-01-01T00:00:00.000Z' } } }),
  )
  await page.route('**/api/v1/auth/update-user', async (route) => {
    if (shouldReject) {
      shouldReject = false
      return route.fulfill({ status: 400, json: { message: '服务暂不可用，请重试。' } })
    }
    const input: unknown = route.request().postDataJSON()
    if (input && typeof input === 'object') {
      if ('name' in input && typeof input.name === 'string') user.name = input.name
      if ('image' in input && (typeof input.image === 'string' || input.image === null)) user.image = input.image
    }
    return route.fulfill({ json: { status: true } })
  })
  await page.route('**/api/v1/auth/change-password', (route) => route.fulfill({ json: { user } }))
  await page.route('**/api/v1/me/tokens', (route) =>
    route.fulfill({
      json: {
        success: true,
        code: 'OK',
        message: 'ok',
        requestId: 'visual-profile',
        data: {
          items: [
            {
              id: '11111111-1111-4111-8111-111111111111',
              name: '本地 CLI',
              tokenPrefix: 'devops_pat_demo',
              status: 'active',
              createdAt: '2026-11-17T04:00:00.000Z',
              expiresAt: '2027-02-17T04:00:00.000Z',
              lastUsedAt: null,
              revokedAt: null,
            },
          ],
        },
      },
    }),
  )
  await page.goto('/settings/profile')
  const profile = page.getByRole('tabpanel', { name: '个人资料' })
  const edit = profile.getByRole('button', { name: '编辑资料' })
  await expect(edit).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('profile.png') })
  await edit.click()
  const editor = page.getByRole('dialog', { name: '编辑资料' })
  await expect(editor).toBeVisible()
  await editor.getByLabel('显示名称').fill('更新后的用户名')
  const file = editor.locator('input[type=file]')
  await file.setInputFiles({ name: 'invalid.png', mimeType: 'image/png', buffer: Buffer.from('invalid image') })
  await expect(editor.getByRole('alert')).toHaveText('无法读取这张图片，请重新选择。')

  const imageUrl = await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 320
    canvas.height = 180
    const context = canvas.getContext('2d')
    if (!context) throw new Error('无法生成测试用图片')
    context.fillStyle = 'dodgerblue'
    context.fillRect(0, 0, 320, 180)
    context.fillStyle = 'seagreen'
    context.fillRect(70, 0, 180, 180)
    context.fillStyle = 'white'
    context.fillRect(115, 45, 90, 90)
    return canvas.toDataURL('image/png')
  })
  const chooserEvent = page.waitForEvent('filechooser')
  await editor.getByRole('button', { name: '上传头像' }).click()
  const chooser = await chooserEvent
  await chooser.setFiles({
    name: 'avatar.png',
    mimeType: 'image/png',
    buffer: Buffer.from(imageUrl.split(',')[1], 'base64'),
  })
  const preview = editor.locator('img[src^="data:image/jpeg;base64,"]')
  await expect(preview).toBeVisible()
  expect(
    await preview.evaluate((image) => image instanceof HTMLImageElement && [image.naturalWidth, image.naturalHeight]),
  ).toEqual([160, 160])
  await page.screenshot({ path: testInfo.outputPath('profile-edit.png') })
  const save = editor.getByRole('button', { name: '保存资料' })
  await save.click()
  await expect(editor.getByRole('alert')).toHaveText('服务暂不可用，请重试。')
  await expect(editor.getByLabel('显示名称')).toHaveValue('更新后的用户名')
  await expect(preview).toBeVisible()
  await save.click()
  await expect(editor).toBeHidden()
  await expect(edit).toBeFocused()
  await expect(profile.getByRole('heading', { name: '更新后的用户名' })).toBeVisible()
  await expect(profile.locator('img[src^="data:image/jpeg;base64,"]')).toBeVisible()
  await expect(page.locator('.sidebar .user img')).toHaveCount(1)

  const passwordEntry = profile.getByRole('button', { name: '修改密码' })
  await passwordEntry.click()
  const password = page.getByRole('dialog', { name: '修改密码' })
  await expect(password.getByLabel('当前密码')).toBeFocused()
  await page.screenshot({ path: testInfo.outputPath('profile-password.png') })
  await password.getByLabel('当前密码').fill('old-test-password')
  await page.keyboard.press('Escape')
  await expect(passwordEntry).toBeFocused()
  await passwordEntry.click()
  await expect(password.getByLabel('当前密码')).toHaveValue('')
  await password.getByLabel('当前密码').fill('old-test-password')
  await password.getByLabel('新密码', { exact: true }).fill('new-test-password')
  await password.getByLabel('确认新密码').fill('different-test-password')
  const update = password.getByRole('button', { name: '更新密码' })
  await update.click()
  await expect(password.getByRole('alert')).toHaveText('两次输入的新密码不一致。')
  await password.getByLabel('确认新密码').fill('new-test-password')
  await update.click()
  await expect(password).toBeHidden()
  await expect(passwordEntry).toBeFocused()

  await page.getByRole('tab', { name: 'API Token' }).click()
  const tokens = page.getByRole('tabpanel', { name: 'API Token' })
  await expect(tokens.getByRole('row', { name: /本地 CLI/ })).toBeVisible()
  await expect(profile).toBeHidden()
  await expect(page).toHaveURL(/\?tab=tokens$/)
  await page.reload()
  await expect(tokens.getByRole('button', { name: '新建 Token' })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('profile-tokens.png') })
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    await page.evaluate(() => window.innerWidth),
  )
  await page.getByRole('tab', { name: '个人资料' }).click()
  await expect(profile.locator('img[src^="data:image/jpeg;base64,"]')).toBeVisible()
  await page.evaluate(() => document.documentElement.classList.add('dark'))
  await page.screenshot({ path: testInfo.outputPath('profile-dark.png') })
  await edit.click()
  await editor.getByRole('button', { name: '移除' }).click()
  await expect(editor.getByRole('button', { name: '上传头像' })).toBeFocused()
  await save.click()
  await expect(edit).toBeFocused()
  await expect(profile.locator('img')).toHaveCount(0)
  await expect(page.locator('.sidebar .user img')).toHaveCount(0)
})
