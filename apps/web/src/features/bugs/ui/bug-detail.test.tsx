import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { createQueryClient } from '@/shared/api/query-client'
import { SessionProvider } from '@/features/identity/public'
import { server, teamFixture } from '@/test/server'
import type { BugDetail } from '../model/types'
import { BugDetailPane } from './bug-detail'

const bug: BugDetail = {
  id: 'bug-1',
  teamId: 'team-1',
  projectId: 'project-1',
  number: 1,
  title: '上传附件后列表为空',
  status: 'pending',
  fixOwner: null,
  regressionOwner: null,
  version: 1,
  updatedAt: '2026-11-11T00:00:00.000Z',
  phenomenon: '上传后列表为空',
  expectedBehavior: '列表显示附件',
  reproduction: '步骤',
  reproductionUnknown: false,
  evidenceText: null,
  evidenceUrl: null,
  createdByUserId: 'user-1',
  createdAt: '2026-11-11T00:00:00.000Z',
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
  ],
  linkedRequirements: [],
  linkedCodeReferences: [],
  regressions: [],
}

function ok(data: unknown) {
  return HttpResponse.json({ success: true, code: 'OK', message: 'ok', requestId: 'trace', data })
}

/** 为缺陷详情注册接口；role 用于验证删除入口的角色差异。 */
function useDetailHandlers(role: 'admin' | 'viewer') {
  server.use(
    http.get('*/api/v1/me/teams', () => ok({ teams: [{ ...teamFixture, role }], isPlatformAdmin: false })),
    http.get('*/api/v1/bugs/bug-1', () => ok(bug)),
    http.get('*/api/v1/projects/project-1', () =>
      ok({
        id: 'project-1',
        teamId: 'team-1',
        name: '测试项目',
        description: null,
        owner: { userId: 'user-1', name: '管理员', status: 'active', available: true },
        status: 'active',
        counts: { openRequirements: 0, openBugs: 1 },
        version: 1,
        createdAt: '2026-11-10T00:00:00.000Z',
        updatedAt: '2026-11-10T00:00:00.000Z',
      }),
    ),
    http.get('*/api/v1/projects/project-1/requirements', () => ok({ items: [], page: 1, pageSize: 100, total: 0 })),
    http.get('*/api/v1/projects/project-1/repositories', () => ok([])),
    http.get('*/api/v1/bugs/bug-1/comments', () => ok({ items: [], page: 1, pageSize: 50, total: 0 })),
    http.get('*/api/v1/bugs/bug-1/activities', () => ok({ items: [], page: 1, pageSize: 50, total: 0 })),
  )
}

function renderDetail() {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <SessionProvider initialUser={{ id: 'user-1', name: '管理员', email: 'admin@example.test' }}>
        <BugDetailPane bugId="bug-1" onClose={() => undefined} />
      </SessionProvider>
    </QueryClientProvider>,
  )
}

describe('BugDetailPane 协作人与附件', () => {
  it('定义列表展示协作人员标签并标注失效成员', async () => {
    useDetailHandlers('admin')
    renderDetail()
    expect((await screen.findAllByText('李艳')).length).toBeGreaterThan(0)
    expect(screen.getByText('已离队成员')).toBeInTheDocument()
    expect(screen.getByText('已失效')).toBeInTheDocument()
  })

  it('现象与预期之后展示附件区与下载链接，管理员可见删除入口', async () => {
    useDetailHandlers('admin')
    renderDetail()
    const attachmentSection = await screen.findByRole('region', { name: '附件' })
    expect(within(attachmentSection).getByText('复现截图.png')).toBeInTheDocument()
    expect(within(attachmentSection).getByRole('link', { name: '下载' })).toHaveAttribute(
      'href',
      '/api/v1/attachments/att-1/download',
    )
    expect(within(attachmentSection).getByRole('button', { name: '删除附件 复现截图.png' })).toBeInTheDocument()
  })

  it('浏览者只读：仍可下载但不展示删除入口', async () => {
    useDetailHandlers('viewer')
    renderDetail()
    const attachmentSection = await screen.findByRole('region', { name: '附件' })
    expect(within(attachmentSection).getByRole('link', { name: '下载' })).toBeInTheDocument()
    expect(within(attachmentSection).queryByRole('button', { name: /删除附件/ })).not.toBeInTheDocument()
  })
})
