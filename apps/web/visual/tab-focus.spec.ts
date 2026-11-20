import { expect, test } from '@playwright/test'
import { installApiMocks } from './mock-api'

test('[desktop][mobile] 指针切换页签时隐藏焦点轮廓，键盘操作时显示', async ({ page }, testInfo) => {
  await installApiMocks(page)
  await page.goto('/settings/profile')
  const tabs = page.getByRole('tablist', { name: '个人页面分组' })
  const profile = tabs.getByRole('tab', { name: '个人资料', exact: true })
  const tokens = tabs.getByRole('tab', { name: 'API Token', exact: true })
  await expect(profile).toHaveAttribute('aria-selected', 'true')

  const usesTouch = testInfo.project.name === 'mobile'
  if (usesTouch) await tokens.tap()
  else await tokens.click()
  await expect(tokens).toHaveAttribute('aria-selected', 'true')
  await expect(tokens).toBeFocused()
  await expect(tokens).toHaveCSS('outline-style', 'none')
  await expect(page).toHaveURL(/tab=tokens/)
  await page.screenshot({ path: testInfo.outputPath('tab-pointer.png') })

  await page.keyboard.press('ArrowLeft')
  await expect(profile).toHaveAttribute('aria-selected', 'true')
  await expect(profile).toBeFocused()
  await expect(profile).toHaveCSS('outline-style', 'solid')
  await page.keyboard.press('ArrowRight')
  await expect(tokens).toHaveAttribute('aria-selected', 'true')
  await expect(tokens).toBeFocused()
  await expect(tokens).toHaveCSS('outline-style', 'solid')
  await page.screenshot({ path: testInfo.outputPath('tab-keyboard.png') })

  if (usesTouch) await tokens.tap()
  else await tokens.click()
  await expect(tokens).toHaveCSS('outline-style', 'none')
})
