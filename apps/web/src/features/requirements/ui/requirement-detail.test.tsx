import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { createQueryClient } from '@/shared/api/query-client'
import { SessionProvider } from '@/features/identity/public'
import { server, teamFixture } from '@/test/server'
import { RequirementDetailPane } from './requirement-detail'

const requirement = {
  id: 'req-1',
  teamId: 'team-1',
  projectId: 'project-1',
  number: 1,
  title: '待复核需求',
  status: 'in_testing',
  devOwner: null,
  testOwner: null,
  version: 3,
  updatedAt: '2026-11-10T00:00:00.000Z',
  contentMode: 'markdown',
  contentMarkdown: '正文',
  externalUrl: null,
  externalSummary: null,
  acceptanceCriteria: null,
  collaborators: [],
  attachments: [],
  latestTestSubmission: null,
  linkedBugs: [{ id: 'bug-1', number: 2, title: '未解决 Bug', status: 'pending' }],
  needsReview: true,
  linkedCodeReferences: [],
  createdAt: '2026-11-10T00:00:00.000Z',
  createdByUserId: 'user-1',
}
function ok(data: unknown) {
  return HttpResponse.json({ success: true, code: 'OK', message: 'ok', requestId: 'trace', data })
}

describe('RequirementDetailPane', () => {
  it('测试中存在未解决 Bug 时显示阻碍项并禁用通过', async () => {
    server.use(
      http.get('*/api/v1/me/teams', () => ok({ teams: [{ ...teamFixture, role: 'admin' }], isPlatformAdmin: false })),
      http.get('*/api/v1/requirements/req-1', () => ok(requirement)),
      http.get('*/api/v1/requirements/req-1/test-pass-eligibility', () =>
        ok({ eligible: false, blockers: [{ id: 'bug-1', number: 2, title: '未解决 Bug', status: 'pending' }] }),
      ),
      http.get('*/api/v1/requirements/req-1/test-submissions', () =>
        ok({ items: [], page: 1, pageSize: 20, total: 0 }),
      ),
      http.get('*/api/v1/projects/project-1/repositories', () => ok([])),
      http.get('*/api/v1/projects/project-1', () =>
        ok({
          id: 'project-1',
          teamId: 'team-1',
          name: '测试项目',
          description: null,
          owner: { userId: 'user-1', name: '管理员', status: 'active', available: true },
          status: 'active',
          counts: { openRequirements: 1, openBugs: 0 },
          version: 1,
          createdAt: '2026-11-10T00:00:00.000Z',
          updatedAt: '2026-11-10T00:00:00.000Z',
        }),
      ),
      http.get('*/api/v1/requirements/req-1/comments', () => ok({ items: [], page: 1, pageSize: 50, total: 0 })),
      http.get('*/api/v1/requirements/req-1/activities', () => ok({ items: [], page: 1, pageSize: 50, total: 0 })),
    )
    render(
      <QueryClientProvider client={createQueryClient()}>
        <SessionProvider initialUser={{ id: 'user-1', name: '管理员', email: 'admin@example.test' }}>
          <RequirementDetailPane requirementId="req-1" onClose={() => undefined} />
        </SessionProvider>
      </QueryClientProvider>,
    )
    expect((await screen.findAllByText(/未解决 Bug/)).length).toBeGreaterThan(0)
    await waitFor(() => expect(screen.getByRole('button', { name: '测试通过' })).toBeDisabled())
    expect(screen.getByText('存在未解决 Bug，需复核')).toBeInTheDocument()
  })
})

describe('RequirementDetailPane 协作人与附件', () => {
  const detailWithAttachments = {
    ...requirement,
    status: 'pending',
    collaborators: [
      { userId: 'user-2', name: '李艳', status: 'active', available: true },
      { userId: 'user-3', name: '已离队成员', status: 'missing', available: false },
    ],
    attachments: [
      {
        id: 'att-1',
        fileName: '复现截图.png',
        sizeBytes: 245_760,
        contentType: 'image/png',
        sha256: 'a'.repeat(64),
        uploadedBy: { userId: 'user-2', name: '李艳', status: 'active', available: true },
        createdAt: '2026-11-11T01:30:00.000Z',
        downloadUrl: '/api/v1/attachments/att-1/download',
      },
      {
        id: 'att-2',
        fileName: '日志.txt',
        sizeBytes: 2048,
        contentType: 'text/plain',
        sha256: 'b'.repeat(64),
        uploadedBy: { userId: 'user-1', name: '管理员', status: 'active', available: true },
        createdAt: '2026-11-11T02:00:00.000Z',
        downloadUrl: '/api/v1/attachments/att-2/download',
      },
    ],
  }

  /** 为详情页测试注册必需接口；附件删除可追加记录被删除的 ID。 */
  function useDetailHandlers(removedAttachmentIds: string[] = []) {
    server.use(
      http.get('*/api/v1/me/teams', () => ok({ teams: [{ ...teamFixture, role: 'admin' }], isPlatformAdmin: false })),
      http.get('*/api/v1/requirements/req-1', () => ok(detailWithAttachments)),
      http.get('*/api/v1/requirements/req-1/test-submissions', () =>
        ok({ items: [], page: 1, pageSize: 20, total: 0 }),
      ),
      http.get('*/api/v1/projects/project-1/repositories', () => ok([])),
      http.get('*/api/v1/projects/project-1', () =>
        ok({
          id: 'project-1',
          teamId: 'team-1',
          name: '测试项目',
          description: null,
          owner: { userId: 'user-1', name: '管理员', status: 'active', available: true },
          status: 'active',
          counts: { openRequirements: 1, openBugs: 0 },
          version: 1,
          createdAt: '2026-11-10T00:00:00.000Z',
          updatedAt: '2026-11-10T00:00:00.000Z',
        }),
      ),
      http.get('*/api/v1/requirements/req-1/comments', () => ok({ items: [], page: 1, pageSize: 50, total: 0 })),
      http.get('*/api/v1/requirements/req-1/activities', () => ok({ items: [], page: 1, pageSize: 50, total: 0 })),
      http.post('*/api/v1/attachments/:attachmentId/remove', ({ params }) => {
        removedAttachmentIds.push(String(params.attachmentId))
        return ok({ id: String(params.attachmentId), removed: true })
      }),
    )
  }

  function renderDetail() {
    return render(
      <QueryClientProvider client={createQueryClient()}>
        <SessionProvider initialUser={{ id: 'user-1', name: '管理员', email: 'admin@example.test' }}>
          <RequirementDetailPane requirementId="req-1" onClose={() => undefined} />
        </SessionProvider>
      </QueryClientProvider>,
    )
  }

  it('协作人员以标签展示并标注失效成员', async () => {
    useDetailHandlers()
    renderDetail()
    expect((await screen.findAllByText('李艳')).length).toBeGreaterThan(0)
    expect(screen.getByText('已离队成员')).toBeInTheDocument()
    expect(screen.getByText('已失效')).toBeInTheDocument()
    expect(screen.getByRole('list', { name: '协作人员' })).toBeInTheDocument()
  })

  it('附件区展示文件名与下载链接，管理员可删除并二次确认', async () => {
    const removedAttachmentIds: string[] = []
    useDetailHandlers(removedAttachmentIds)
    renderDetail()
    const attachmentSection = await screen.findByRole('region', { name: '附件' })
    expect(within(attachmentSection).getByText('复现截图.png')).toBeInTheDocument()
    const downloadLinks = within(attachmentSection).getAllByRole('link', { name: '下载' })
    expect(downloadLinks[0]).toHaveAttribute('href', '/api/v1/attachments/att-1/download')
    await userEvent.click(within(attachmentSection).getByRole('button', { name: '删除附件 复现截图.png' }))
    expect(await screen.findByText(/删除后不可恢复/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '删除' }))
    await waitFor(() => expect(removedAttachmentIds).toEqual(['att-1']))
  })
})
