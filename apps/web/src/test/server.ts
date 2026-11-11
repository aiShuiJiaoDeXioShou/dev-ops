import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { storageHandlers } from './storage-handlers'

/** 测试用当前用户会话。 */
export const sessionFixture = {
  user: { id: 'user-1', name: '测试用户', email: 'user@example.test' },
  session: { id: 'session-1', userId: 'user-1', expiresAt: '2099-01-01T00:00:00.000Z' },
}

/** 测试用团队与成员。 */
export const teamFixture = { id: 'team-1', name: '测试团队', role: 'admin', status: 'active' }
export const memberFixture = {
  userId: sessionFixture.user.id,
  name: sessionFixture.user.name,
  email: sessionFixture.user.email,
  role: 'admin',
  status: 'active',
  joinedAt: '2026-11-10T00:00:00.000Z',
}

export function success(data: unknown, requestId = 'test-request') {
  return HttpResponse.json(
    { success: true, code: 'OK', message: 'ok', requestId, data },
    { headers: { 'x-request-id': requestId } },
  )
}

/** 附件策略默认值；与会话层测试共享，具体用例可覆盖更小的上限。 */
export const attachmentPolicyFixture = {
  maxFileBytes: 50 * 1024 * 1024,
  maxFilesPerSubmit: 10,
  maxFilesPerRecord: 50,
  tempRetentionHours: 24,
}

/** 上传成功时返回的附件标识计数；测试用例通常覆盖 handler 以固定 ID。 */
let uploadSequence = 0

/**
 * 附件相关默认 handler：策略、上传与删除；未覆盖时让表单相关测试可正常挂载附件区。
 */
export const attachmentHandlers = [
  http.get('*/api/v1/attachments/policy', () => success(attachmentPolicyFixture)),
  http.post('*/api/v1/projects/:projectId/attachments', async ({ request }) => {
    uploadSequence += 1
    const encodedName = request.headers.get('x-file-name') ?? ''
    const body = await request.arrayBuffer()
    return success({
      attachment: {
        id: `attachment-${uploadSequence}`,
        fileName: decodeURIComponent(encodedName),
        sizeBytes: body.byteLength,
        contentType: request.headers.get('x-file-type'),
        sha256: 'a'.repeat(64),
        status: 'temp',
        uploadedAt: '2026-11-11T00:00:00.000Z',
      },
    })
  }),
  http.post('*/api/v1/attachments/:attachmentId/remove', ({ params }) =>
    success({ id: String(params.attachmentId), removed: true }),
  ),
]

/** 仅在测试中拦截网络，未声明的请求由测试配置报告错误。 */
export const server = setupServer(
  http.get('http://localhost/api/v1/ready', () =>
    HttpResponse.json(
      { success: true, code: 'OK', message: 'ok', requestId: 'test-request', data: { status: 'ok', database: 'ok' } },
      { headers: { 'x-request-id': 'test-request' } },
    ),
  ),
  http.get('*/api/v1/auth/get-session', () => HttpResponse.json(sessionFixture)),
  http.get('*/api/v1/me/teams', () => success({ teams: [teamFixture], isPlatformAdmin: false })),
  http.get('*/api/v1/teams/:teamId/project-activity', () =>
    success({
      timezone: 'UTC',
      from: '2025-11-05',
      to: '2026-11-10',
      source: 'all',
      sourceStatus: { activity: 'ok', code: 'unknown', pullRequest: 'unknown' },
      days: [],
      projects: [
        {
          projectId: 'project-1',
          status: 'active',
          owner: { userId: 'user-1', name: '测试用户', available: true },
          items: { total: 4, completed: 2 },
          pendingRequirements: 1,
          pendingBugs: 1,
          pendingPullRequests: null,
          bots: null,
        },
      ],
    }),
  ),
  http.get('*/api/v1/teams/:teamId/projects', () =>
    success({
      items: [
        {
          id: 'project-1',
          teamId: 'team-1',
          name: '测试项目',
          description: '示例项目',
          owner: { userId: 'user-1', name: '测试用户' },
          status: 'active',
          counts: { openRequirements: 2, openBugs: 1 },
          version: 1,
          createdAt: '2026-11-10T00:00:00.000Z',
          updatedAt: '2026-11-10T00:00:00.000Z',
        },
      ],
      page: 1,
      pageSize: 20,
      total: 1,
    }),
  ),
  http.get('*/api/v1/teams/:teamId/members', () => success([memberFixture])),
  ...attachmentHandlers,
  ...storageHandlers,
  http.get('*/api/v1/git-providers', () =>
    success([
      { providerKey: 'github', name: 'GitHub', authModes: ['github_cli'] },
      { providerKey: 'gitea', name: 'Gitea', authModes: ['gitea_token'] },
    ]),
  ),
)
