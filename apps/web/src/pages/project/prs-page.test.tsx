import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { MemoryRouter, Route, Routes } from 'react-router'
import { describe, expect, it } from 'vitest'
import { createQueryClient } from '@/shared/api/query-client'
import { server, success } from '@/test/server'
import { Component as PrsPage } from './prs-page'

const repository = {
  id: 'repo-1',
  name: 'web',
  namespace: 'ns',
  provider: 'github',
  defaultBranch: 'main',
  webUrl: 'https://example.test/ns/web',
  status: 'available',
}
const pullRequest = {
  number: 12,
  title: '交付页面',
  authorName: '测试用户',
  sourceBranch: 'feat/delivery',
  targetBranch: 'main',
  state: 'open',
  reviewStatus: 'pending',
  createdAt: '2026-11-09T08:00:00.000Z',
  updatedAt: '2026-11-10T08:00:00.000Z',
  mergedAt: null,
  url: 'https://example.test/ns/web/pull/12',
  lastCheckedAt: '2026-11-10T09:00:00.000Z',
  files: [],
  truncated: false,
}

function renderPage() {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <MemoryRouter initialEntries={['/projects/project-1/prs']}>
        <Routes>
          <Route path="/projects/:projectId/prs" element={<PrsPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('prs-page', () => {
  it('未关联仓库时给出引导，不请求 PR', async () => {
    server.use(http.get('*/api/v1/projects/project-1/repositories', () => success([])))
    renderPage()
    expect(await screen.findByText('尚未关联仓库')).toBeInTheDocument()
  })

  it('展示 PR 列表并支持按状态筛选与打开详情差异', async () => {
    server.use(
      http.get('*/api/v1/projects/project-1/repositories', () => success([repository])),
      http.get('*/api/v1/projects/project-1/repositories/repo-1/pull-requests', () =>
        success({ items: [pullRequest], page: 1, pageSize: 20, total: 1 }),
      ),
      http.get('*/api/v1/projects/project-1/repositories/repo-1/pull-requests/12', () =>
        success({ ...pullRequest, files: [{ ...pullRequest.files }] }),
      ),
      http.get('*/api/v1/projects/project-1/repositories/repo-1/pull-requests/12/diff', () =>
        success({ patch: '+ 变更内容', truncated: true }),
      ),
    )
    renderPage()
    expect(await screen.findByText(/#12 交付页面/)).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'PR 状态' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /#12 交付页面/ }))
    expect(await screen.findByLabelText('PR 差异')).toBeInTheDocument()
    expect(screen.getByText(/内容已截断/)).toBeInTheDocument()
  })
})
