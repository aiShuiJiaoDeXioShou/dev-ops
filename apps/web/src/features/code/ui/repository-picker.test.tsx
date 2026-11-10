import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { createQueryClient } from '@/shared/api/query-client'
import { server } from '@/test/server'
import { RepositoryPicker } from './repository-picker'

function ok(data: unknown) {
  return HttpResponse.json({ success: true, code: 'OK', message: 'ok', requestId: 'trace', data })
}

const availableRepository = (id: string, name: string) => ({
  id,
  connectionId: 'conn-1',
  providerKey: 'github',
  namespace: 'acme',
  name,
  webUrl: `https://github.com/acme/${name}`,
  defaultBranch: 'main',
  status: 'available',
})

describe('RepositoryPicker', () => {
  it('无已关联仓库时提示使用关联仓库按钮', async () => {
    server.use(http.get('*/api/v1/projects/project-1/repositories', () => ok([])))
    render(
      <QueryClientProvider client={createQueryClient()}>
        <RepositoryPicker projectId="project-1" canManage />
      </QueryClientProvider>,
    )
    expect(await screen.findByText('还没有关联仓库。使用上方「关联仓库」按钮添加。')).toBeInTheDocument()
  })

  it('展示已关联仓库', async () => {
    server.use(
      http.get('*/api/v1/projects/project-1/repositories', () =>
        ok([{ ...availableRepository('repo-1', 'dev-ops'), status: 'available' }]),
      ),
      http.get('*/api/v1/projects/project-1/repositories/available', () =>
        ok({ items: [], page: 1, pageSize: 100, total: 0 }),
      ),
    )
    render(
      <QueryClientProvider client={createQueryClient()}>
        <RepositoryPicker projectId="project-1" canManage={false} />
      </QueryClientProvider>,
    )
    expect(await screen.findByRole('link', { name: 'acme/dev-ops' })).toBeInTheDocument()
  })

  it('管理员可对已关联仓库发起解除关联', async () => {
    server.use(
      http.get('*/api/v1/projects/project-1/repositories', () =>
        ok([{ ...availableRepository('repo-1', 'dev-ops'), status: 'available' }]),
      ),
      http.get('*/api/v1/projects/project-1/repositories/available', () =>
        ok({ items: [], page: 1, pageSize: 100, total: 0 }),
      ),
    )
    render(
      <QueryClientProvider client={createQueryClient()}>
        <RepositoryPicker projectId="project-1" canManage />
      </QueryClientProvider>,
    )
    await userEvent.click(await screen.findByRole('button', { name: '解除关联' }))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '确认解除' })).toBeDisabled()
  })
})
