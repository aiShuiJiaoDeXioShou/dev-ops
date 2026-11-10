import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { createQueryClient } from '@/shared/api/query-client'
import { server } from '@/test/server'
import { TeamGitConnections } from './team-git-connections'

function ok(data: unknown) {
  return HttpResponse.json({ success: true, code: 'OK', message: 'ok', requestId: 'trace', data })
}

const connection = (overrides: Record<string, unknown>) => ({
  id: 'conn-1',
  teamId: 'team-1',
  providerKey: 'github',
  instanceUrl: 'https://github.com',
  name: 'GitHub App',
  status: 'active',
  authKind: 'github_app_installation',
  externalIdentity: '1',
  lastCheckedAt: '2026-11-10T00:00:00.000Z',
  lastErrorCode: null,
  repositoryScopeSyncedAt: '2026-11-10T00:00:00.000Z',
  createdAt: '2026-11-10T00:00:00.000Z',
  ...overrides,
})

function renderConnections(canManage: boolean) {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <TeamGitConnections teamId="team-1" canManage={canManage} />
    </QueryClientProvider>,
  )
}

describe('TeamGitConnections', () => {
  it('无连接时给管理员提供添加 GitHub 入口', async () => {
    server.use(http.get('*/api/v1/teams/team-1/git-connections', () => ok([])))
    renderConnections(true)
    expect(await screen.findByText('还没有可用的 Git 连接')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '添加 GitHub 连接' })).toBeInTheDocument()
  })

  it('管理员可检查和同步可用连接，已撤销连接不再提供操作', async () => {
    server.use(
      http.get('*/api/v1/teams/team-1/git-connections', () =>
        ok([
          connection({ id: 'conn-1', name: 'GitHub App' }),
          connection({
            id: 'conn-2',
            name: '旧 CLI 连接',
            authKind: 'github_cli',
            status: 'revoked',
          }),
        ]),
      ),
    )
    renderConnections(true)
    expect(await screen.findByText('GitHub App')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: '检查' })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: '同步仓库' })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: '撤销' })).toHaveLength(1)
    expect(screen.getByText('已撤销连接（1）')).toBeInTheDocument()
    expect(screen.getByText('旧 CLI 连接')).toBeInTheDocument()
  })

  it('非管理员只读，不显示写操作', async () => {
    server.use(
      http.get('*/api/v1/teams/team-1/git-connections', () => ok([connection({ id: 'conn-1', name: 'GitHub App' })])),
    )
    renderConnections(false)
    expect(await screen.findByText('GitHub App')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '添加 GitHub 连接' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '检查' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '撤销' })).not.toBeInTheDocument()
  })
})
