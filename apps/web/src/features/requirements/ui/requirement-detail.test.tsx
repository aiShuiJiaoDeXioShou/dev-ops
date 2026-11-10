import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { createQueryClient } from '@/shared/api/query-client'
import { SessionProvider } from '@/features/identity/public'
import { server } from '@/test/server'
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
      http.get('*/api/v1/requirements/req-1', () => ok(requirement)),
      http.get('*/api/v1/requirements/req-1/test-pass-eligibility', () =>
        ok({ eligible: false, blockers: [{ id: 'bug-1', number: 2, title: '未解决 Bug', status: 'pending' }] }),
      ),
      http.get('*/api/v1/requirements/req-1/test-submissions', () =>
        ok({ items: [], page: 1, pageSize: 20, total: 0 }),
      ),
      http.get('*/api/v1/projects/project-1/repositories', () => ok([])),
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
