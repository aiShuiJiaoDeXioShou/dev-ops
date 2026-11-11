import type { Page } from '@playwright/test'
import { apiFixtures, VISUAL_IDS } from './fixtures'

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

/** 产物页需要有数据才能覆盖行布局；使用稳定的合成产物。 */
const artifactPage = envelope({
  items: [
    {
      id: '11111111-1111-4111-8111-111111111111',
      buildId: '22222222-2222-4222-8222-222222222222',
      serviceId: null,
      environment: null,
      artifactType: 'web_test_url',
      versionLabel: 'v0.0.1-visual',
      accessUrl: 'https://example.test/preview',
      source: 'external_system',
      collectedAt: '2026-11-11T03:00:00.000Z',
      status: 'available',
      note: null,
      isLatest: true,
    },
  ],
  page: 1,
  pageSize: 50,
  total: 1,
})

/** 开发环境变量页需要有数据才能覆盖名称、值、状态与操作行。 */
const envVariablePage = envelope({
  items: [
    {
      id: '33333333-3333-4333-8333-333333333333',
      projectId: VISUAL_IDS.projectId,
      environment: 'development',
      name: 'VISUAL_API_BASE_URL',
      kind: 'plain',
      status: 'active',
      version: 1,
      credential: null,
      valuePreview: 'https://api.visual.example.test',
      masked: false,
      invalidReason: null,
      updatedAt: '2026-11-11T03:00:00.000Z',
    },
  ],
  page: 1,
  pageSize: 20,
  total: 1,
})

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
    if (path === `/api/v1/projects/${VISUAL_IDS.projectId}/artifacts`) {
      return route.fulfill({ json: artifactPage })
    }
    if (path === `/api/v1/projects/${VISUAL_IDS.projectId}/environments/development/variables`) {
      return route.fulfill({ json: envVariablePage })
    }
    if (path.includes('/eligibility')) {
      return route.fulfill({ json: envelope({ eligible: true, blockers: [] }) })
    }
    if (apiFixtures[path]) return route.fulfill({ json: apiFixtures[path] })
    return route.fulfill({ json: emptyPage() })
  })
}
