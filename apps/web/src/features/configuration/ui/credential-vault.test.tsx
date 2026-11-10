import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { http } from 'msw'
import { describe, expect, it } from 'vitest'
import { SessionProvider } from '@/features/identity/public'
import { createQueryClient } from '@/shared/api/query-client'
import { server, sessionFixture, success } from '@/test/server'
import { ToastProvider } from '@/shared/ui/toast'
import { CredentialVault } from './credential-vault'

describe('CredentialVault', () => {
  it('管理员可进入凭据库，空态提示添加凭据且不展示明文', async () => {
    server.use(
      http.get('*/api/v1/teams/team-1/credentials', () => success({ items: [], page: 1, pageSize: 20, total: 0 })),
    )
    render(
      <QueryClientProvider client={createQueryClient()}>
        <SessionProvider initialUser={sessionFixture.user}>
          <ToastProvider>
            <CredentialVault />
          </ToastProvider>
        </SessionProvider>
      </QueryClientProvider>,
    )
    expect(await screen.findByText('凭据库还是空的')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: '添加凭据' }).length).toBeGreaterThan(0)
  })
})
