import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { createQueryClient } from '@/shared/api/query-client'
import { server } from '@/test/server'
import { RepositoryPicker } from './repository-picker'

function ok(data: unknown) {
  return HttpResponse.json({ success: true, code: 'OK', message: 'ok', requestId: 'trace', data })
}

describe('RepositoryPicker', () => {
  it('无仓库与连接时显示明确空状态', async () => {
    server.use(
      http.get('*/api/v1/projects/project-1/repositories', () => ok([])),
      http.get('*/api/v1/projects/project-1/repositories/available', () =>
        ok({ items: [], page: 1, pageSize: 20, total: 0 }),
      ),
      http.get('*/api/v1/teams/team-1/git-connections', () => ok([])),
    )
    render(
      <QueryClientProvider client={createQueryClient()}>
        <RepositoryPicker projectId="project-1" teamId="team-1" canManage={false} />
      </QueryClientProvider>,
    )
    expect(await screen.findByText('尚未关联仓库。')).toBeInTheDocument()
  })

  it('展示连接状态与检查、同步操作', async () => {
    server.use(
      http.get('*/api/v1/projects/project-1/repositories', () => ok([])),
      http.get('*/api/v1/projects/project-1/repositories/available', () =>
        ok({ items: [], page: 1, pageSize: 20, total: 0 }),
      ),
      http.get('*/api/v1/teams/team-1/git-connections', () =>
        ok([
          {
            id: 'conn-1',
            teamId: 'team-1',
            providerKey: 'github',
            instanceUrl: 'https://github.com',
            name: 'GitHub 连接',
            status: 'invalid',
            authKind: 'github_cli',
            externalIdentity: null,
            lastCheckedAt: null,
            lastErrorCode: 'auth_failed',
            repositoryScopeSyncedAt: null,
            createdAt: '2026-11-10T00:00:00.000Z',
          },
        ]),
      ),
    )
    render(
      <QueryClientProvider client={createQueryClient()}>
        <RepositoryPicker projectId="project-1" teamId="team-1" canManage />
      </QueryClientProvider>,
    )
    expect(await screen.findByText(/GitHub 连接/)).toBeInTheDocument()
    expect(await screen.findByText('invalid')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: '检查' }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('button', { name: '同步仓库' }).length).toBeGreaterThan(0)
  })
})
