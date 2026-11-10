import { http } from 'msw'
import { success } from './server'

/** V0.2 页面测试的 MSW handler 骨架；各用户故事实现页面后按需补充具体响应。 */
export const v02Handlers = [
  http.get('*/api/v1/teams/:teamId/project-activity', () =>
    success({
      timezone: 'UTC',
      from: '2025-11-05',
      to: '2026-11-10',
      source: 'all',
      sourceStatus: { activity: 'ok', code: 'ok', pullRequest: 'ok' },
      days: [],
      projects: [],
    }),
  ),
]
