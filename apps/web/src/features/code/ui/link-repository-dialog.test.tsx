import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { createQueryClient } from '@/shared/api/query-client'
import { server } from '@/test/server'
import { ToastProvider } from '@/shared/ui/toast'
import { LinkRepositoryDialog } from './link-repository-dialog'

function ok(data: unknown) {
  return HttpResponse.json({ success: true, code: 'OK', message: 'ok', requestId: 'trace', data })
}

const repository = (id: string, name: string) => ({
  id,
  connectionId: 'conn-1',
  providerKey: 'github',
  namespace: 'acme',
  name,
  webUrl: `https://github.com/acme/${name}`,
  defaultBranch: 'main',
  status: 'available',
})

describe('LinkRepositoryDialog', () => {
  it('搜索选择仓库后提交关联请求并关闭', async () => {
    let linkedRepositoryId = ''
    server.use(
      http.get('*/api/v1/projects/project-1/repositories/available', () =>
        ok({
          items: [repository('repo-1', 'dev-ops'), repository('repo-2', 'lkwg')],
          page: 1,
          pageSize: 100,
          total: 2,
        }),
      ),
      http.post('*/api/v1/projects/project-1/repositories', async ({ request }) => {
        const body = (await request.json()) as { repositoryId: string }
        linkedRepositoryId = body.repositoryId
        return ok([repository('repo-2', 'lkwg')])
      }),
    )
    const onOpenChange = vi.fn()
    render(
      <QueryClientProvider client={createQueryClient()}>
        <ToastProvider>
          <LinkRepositoryDialog projectId="project-1" open onOpenChange={onOpenChange} />
        </ToastProvider>
      </QueryClientProvider>,
    )
    await userEvent.click(await screen.findByRole('combobox', { name: '选择仓库' }))
    await userEvent.type(await screen.findByLabelText('搜索仓库'), 'lkwg')
    await userEvent.click(await screen.findByRole('option', { name: 'acme/lkwg' }))
    await userEvent.click(screen.getByRole('button', { name: '关联仓库' }))
    expect(linkedRepositoryId).toBe('repo-2')
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('没有可用仓库时提示去团队设置同步', async () => {
    server.use(
      http.get('*/api/v1/projects/project-1/repositories/available', () =>
        ok({ items: [], page: 1, pageSize: 100, total: 0 }),
      ),
    )
    render(
      <QueryClientProvider client={createQueryClient()}>
        <ToastProvider>
          <LinkRepositoryDialog projectId="project-1" open onOpenChange={() => undefined} />
        </ToastProvider>
      </QueryClientProvider>,
    )
    expect(await screen.findByText(/团队还没有已同步的可用仓库/)).toBeInTheDocument()
  })
})
