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
  providerKey: 'github',
  defaultBranch: 'main',
  webUrl: 'https://example.test/ns/web',
  status: 'available',
}
const basePullRequest = {
  authorName: '测试用户',
  sourceBranch: 'feat/delivery',
  targetBranch: 'main',
  reviewStatus: 'pending',
  createdAt: '2026-11-09T08:00:00.000Z',
  updatedAt: '2026-11-10T08:00:00.000Z',
  mergedAt: null,
  url: 'https://example.test/ns/web/pull/12',
  lastCheckedAt: '2026-11-10T09:00:00.000Z',
  files: [],
  truncated: false,
}
const openPullRequest = { ...basePullRequest, number: 12, title: '交付页面', state: 'open' }
const closedPullRequest = {
  ...basePullRequest,
  number: 13,
  title: '修复登录',
  state: 'closed',
  reviewStatus: 'changes_requested',
  updatedAt: '2026-11-09T08:00:00.000Z',
}
const mergedPullRequest = {
  ...basePullRequest,
  number: 14,
  title: '合并发布',
  state: 'merged',
  reviewStatus: 'approved',
  mergedAt: '2026-11-10T08:00:00.000Z',
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

  it('默认请求全部状态并对单个仓库隐藏仓库选择器', async () => {
    let requestedState = ''
    server.use(
      http.get('*/api/v1/projects/project-1/repositories', () => success([repository])),
      http.get('*/api/v1/projects/project-1/repositories/repo-1/pull-requests', ({ request }) => {
        requestedState = new URL(request.url).searchParams.get('state') ?? ''
        return success({
          items: [openPullRequest, closedPullRequest, mergedPullRequest],
          page: 1,
          pageSize: 100,
          total: 3,
        })
      }),
    )
    renderPage()
    expect(await screen.findByRole('button', { name: '交付页面' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /已关闭/ })).toHaveTextContent('2')
    expect(screen.queryByRole('combobox', { name: '仓库' })).not.toBeInTheDocument()
    expect(requestedState).toBe('all')

    await userEvent.click(screen.getByRole('button', { name: /^已关闭/ }))
    expect(screen.getByRole('button', { name: '修复登录' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '合并发布' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '交付页面' })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /^打开/ }))
    expect(screen.getByRole('button', { name: '交付页面' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '修复登录' })).not.toBeInTheDocument()
  })

  it('支持搜索、作者与评审状态筛选，并打开详情差异', async () => {
    server.use(
      http.get('*/api/v1/projects/project-1/repositories', () => success([repository])),
      http.get('*/api/v1/projects/project-1/repositories/repo-1/pull-requests', () =>
        success({
          items: [openPullRequest, closedPullRequest, mergedPullRequest],
          page: 1,
          pageSize: 100,
          total: 3,
        }),
      ),
      http.get('*/api/v1/projects/project-1/repositories/repo-1/pull-requests/12', () =>
        success({
          ...openPullRequest,
          files: [
            {
              path: 'src/app.tsx',
              status: 'modified',
              additions: 2,
              deletions: 1,
              patch: '+ 变更内容',
              binary: false,
              truncated: false,
            },
          ],
        }),
      ),
      http.get('*/api/v1/projects/project-1/repositories/repo-1/pull-requests/12/diff', () =>
        success({ patch: '+ 变更内容', truncated: true }),
      ),
    )
    renderPage()
    await screen.findByRole('button', { name: '交付页面' })
    await userEvent.type(screen.getByLabelText('搜索 PR'), '不存在')
    expect(await screen.findByText('没有匹配的 PR')).toBeInTheDocument()
    const [clearButton] = screen.getAllByRole('button', { name: '清除筛选' })
    if (!clearButton) throw new Error('缺少清除筛选按钮')
    await userEvent.click(clearButton)
    await userEvent.click(screen.getByRole('button', { name: '交付页面' }))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('#12 交付页面')).toBeInTheDocument()
    expect(screen.getByLabelText('PR 差异')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '查看完整差异' }))
    expect(await screen.findByText(/差异已截断/)).toBeInTheDocument()
  })
})
