import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { createQueryClient } from '@/shared/api/query-client'
import { server } from '@/test/server'
import { ToastProvider } from '@/shared/ui/toast'
import { projectRepositoriesQueryOptions } from '../api/queries'
import { LinkRepositoryDialog } from './link-repository-dialog'

function ok(data: unknown) {
  return HttpResponse.json({ success: true, code: 'OK', message: 'ok', requestId: 'trace', data })
}

const repository = (id: string, name: string, connectionId = 'conn-1', providerKey = 'github') => ({
  id,
  connectionId,
  providerKey,
  namespace: 'acme',
  name,
  webUrl: `https://github.com/acme/${name}`,
  defaultBranch: 'main',
  status: 'available',
})

const gitConnection = (id: string, providerKey: string, name: string) => ({
  id,
  providerKey,
  name,
  teamId: 'team-1',
  instanceUrl: 'https://example.test',
  status: 'active',
  authKind: 'test',
  externalIdentity: null,
  lastCheckedAt: null,
  lastErrorCode: null,
  repositoryScopeSyncedAt: null,
  createdAt: '2026-11-01T00:00:00Z',
})

describe('LinkRepositoryDialog', () => {
  it('按来源区分同名仓库并提交选中连接的仓库', async () => {
    let linkedRepositoryId = ''
    server.use(
      http.get('*/api/v1/projects/project-1/repositories/available', () =>
        ok({
          items: [repository('repo-1', 'lkwg'), repository('repo-2', 'lkwg', 'conn-2', 'gitea')],
          page: 1,
          pageSize: 100,
          total: 2,
        }),
      ),
      http.get('*/api/v1/teams/team-1/git-connections', () =>
        ok([gitConnection('conn-1', 'github', '个人账号'), gitConnection('conn-2', 'gitea', '工作账号')]),
      ),
      http.get('*/api/v1/projects/project-1/repositories', () =>
        ok(linkedRepositoryId ? [repository('repo-2', 'lkwg', 'conn-2', 'gitea')] : []),
      ),
      http.post('*/api/v1/projects/project-1/repositories', async ({ request }) => {
        const body = (await request.json()) as { repositoryId: string }
        linkedRepositoryId = body.repositoryId
        return ok([repository('repo-2', 'lkwg')])
      }),
    )
    const onOpenChange = vi.fn()
    const queryClient = createQueryClient()
    const { queryKey } = projectRepositoriesQueryOptions('project-1')
    queryClient.setQueryData(queryKey, { requestId: 'trace', data: [] })
    render(
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <LinkRepositoryDialog teamId="team-1" projectId="project-1" open onOpenChange={onOpenChange} />
        </ToastProvider>
      </QueryClientProvider>,
    )
    await userEvent.selectOptions(await screen.findByRole('combobox', { name: '来源连接' }), 'conn-2')
    await userEvent.click(screen.getByRole('combobox', { name: '选择仓库' }))
    await userEvent.type(await screen.findByLabelText('搜索仓库'), 'lkwg')
    await userEvent.click(await screen.findByRole('option', { name: 'acme/lkwg' }))
    await userEvent.click(screen.getByRole('button', { name: '添加仓库' }))
    expect(linkedRepositoryId).toBe('repo-2')
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(queryClient.getQueryData(queryKey)).toMatchObject({ data: [{ id: 'repo-2' }] })
  })

  it('没有可用仓库时提示去团队设置同步', async () => {
    server.use(
      http.get('*/api/v1/teams/team-1/git-connections', () => ok([])),
      http.get('*/api/v1/projects/project-1/repositories', () => ok([])),
      http.get('*/api/v1/projects/project-1/repositories/available', () =>
        ok({ items: [], page: 1, pageSize: 100, total: 0 }),
      ),
    )
    render(
      <QueryClientProvider client={createQueryClient()}>
        <ToastProvider>
          <LinkRepositoryDialog teamId="team-1" projectId="project-1" open onOpenChange={() => undefined} />
        </ToastProvider>
      </QueryClientProvider>,
    )
    expect(await screen.findByText(/团队还没有已同步的可用仓库/)).toBeInTheDocument()
  })
})
