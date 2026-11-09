import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'

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

/** 仅在测试中拦截网络，未声明的请求由测试配置报告错误。 */
export const server = setupServer(
  http.get('http://localhost/api/v1/ready', () =>
    HttpResponse.json(
      { success: true, code: 'OK', message: 'ok', requestId: 'test-request', data: { status: 'ok', database: 'ok' } },
      { headers: { 'x-request-id': 'test-request' } },
    ),
  ),
  http.get('*/api/v1/auth/get-session', () => HttpResponse.json(sessionFixture)),
  http.get('*/api/v1/me/teams', () => success([teamFixture])),
  http.get('*/api/v1/teams/:teamId/members', () => success([memberFixture])),
  http.get('*/api/v1/git-providers', () =>
    success([
      { providerKey: 'github', name: 'GitHub', authModes: ['github_cli'] },
      { providerKey: 'gitea', name: 'Gitea', authModes: ['gitea_token'] },
    ]),
  ),
)
