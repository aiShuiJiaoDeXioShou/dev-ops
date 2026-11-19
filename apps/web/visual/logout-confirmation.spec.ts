import { expect, test } from '@playwright/test'
import { installApiMocks } from './mock-api'

test('[desktop] [mobile] 退出确认在明暗主题中保持紧凑布局和键盘焦点', async ({ page }, testInfo) => {
  await installApiMocks(page)
  await page.goto('/projects')
  await expect(page.getByRole('heading', { name: '项目', exact: true })).toBeVisible()
  const isMobile = testInfo.project.name === 'mobile'
  if (isMobile) await page.getByRole('button', { name: '打开导航' }).click()

  const trigger = page.getByRole('button', { name: '退出登录', exact: true })
  const dialog = page.getByRole('alertdialog', { name: '退出登录' })
  const cancel = dialog.getByRole('button', { name: '取消' })
  const confirm = dialog.getByRole('button', { name: '确认退出' })
  for (const mode of ['light', 'dark']) {
    await page.evaluate((dark) => document.documentElement.classList.toggle('dark', dark), mode === 'dark')
    await trigger.click()
    await expect(cancel).toBeFocused()
    const cancelBox = await cancel.boundingBox()
    const confirmBox = await confirm.boundingBox()
    expect(cancelBox?.y).toEqual(confirmBox?.y)
    expect(cancelBox?.height ?? 0).toBeGreaterThanOrEqual(isMobile ? 44 : 32)
    await page.screenshot({ path: testInfo.outputPath(`logout-${mode}.png`) })
    await page.keyboard.press('Tab')
    await expect(confirm).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(cancel).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(trigger).toBeFocused()
  }
})
