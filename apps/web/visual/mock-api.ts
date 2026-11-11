import type { Page } from '@playwright/test'
import { apiFixtures } from './fixtures'

/** 视觉回归测试的附件策略；与后端默认上限保持一致。 */
const attachmentPolicy = {
  maxFileBytes: 52_428_800,
  maxFilesPerSubmit: 10,
  maxFilesPerRecord: 50,
  tempRetentionHours: 24,
}

function envelope(data: unknown) {
  return { success: true, code: 'OK', message: 'ok', requestId: 'visual-request', data }
}

function emptyPage() {
  return envelope({ items: [], page: 1, pageSize: 20, total: 0 })
}

/**
 * 为视觉测试安装确定性的 API 模拟。
 * 已采集的接口返回脱敏真实响应；未采集的列表接口返回空列表，避免测试依赖本机后端。
 * @param page Playwright 页面。
 * @returns 安装完成的 Promise。
 */
export async function installApiMocks(page: Page): Promise<void> {
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/v1/attachments/policy') return route.fulfill({ json: envelope(attachmentPolicy) })
    if (path.includes('/eligibility')) {
      return route.fulfill({ json: envelope({ eligible: true, blockers: [] }) })
    }
    if (apiFixtures[path]) return route.fulfill({ json: apiFixtures[path] })
    return route.fulfill({ json: emptyPage() })
  })
}
