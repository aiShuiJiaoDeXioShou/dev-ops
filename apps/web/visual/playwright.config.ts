import { defineConfig } from '@playwright/test'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'

/** 本地已有 Chromium 时复用，避免每次重新下载；CI 由 playwright install 提供。 */
const localChromium = `${homedir()}/Library/Caches/ms-playwright/chromium-1155/chrome-mac/Chromium.app/Contents/MacOS/Chromium`
const chromiumExecutable =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ?? (existsSync(localChromium) ? localChromium : undefined)

/**
 * 视觉与布局回归配置：由 mock API 提供确定性数据，不依赖本机数据库或后端。
 * 快照只包含可跨平台稳定的语义与布局不变量；截图作为失败排查与人工评审产物。
 */
export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.ts/,
  timeout: 60_000,
  fullyParallel: true,
  workers: 2,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: 'http://localhost:5174',
    locale: 'zh-CN',
    timezoneId: 'Asia/Singapore',
    screenshot: 'only-on-failure',
    launchOptions: chromiumExecutable ? { executablePath: chromiumExecutable } : {},
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'pnpm dev --port 5174 --strictPort',
    url: 'http://localhost:5174',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  expect: {
    toMatchSnapshot: { maxDiffPixels: 0 },
  },
  projects: [
    { name: 'desktop', grep: /\[desktop\]/, use: { viewport: { width: 1440, height: 1000 } } },
    {
      name: 'mobile',
      grep: /\[mobile\]/,
      use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
    },
  ],
  snapshotPathTemplate: '{testDir}/__snapshots__/{projectName}/{testFilePath}/{arg}{ext}',
})
