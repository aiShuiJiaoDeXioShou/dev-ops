import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { createQueryClient } from '@/shared/api/query-client'
import { server, sessionFixture } from '@/test/server'
import { SessionProvider } from '@/features/identity/public'
import { ToastProvider } from '@/shared/ui/toast'
import { MemberManagement } from './member-management'

const member = {
  userId: 'user-1',
  name: '管理员',
  email: 'admin@example.test',
  role: 'admin',
  status: 'active',
  joinedAt: '2026-11-10T00:00:00.000Z',
}

function ok(data: unknown) {
  return HttpResponse.json({ success: true, code: 'OK', message: 'ok', requestId: 'trace', data })
}

function renderMembers(canManage: boolean) {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <SessionProvider initialUser={sessionFixture.user}>
        <ToastProvider>
          <MemberManagement teamId="team-1" canManage={canManage} />
        </ToastProvider>
      </SessionProvider>
    </QueryClientProvider>,
  )
}

describe('MemberManagement', () => {
  it('只读角色不能管理成员', async () => {
    server.use(
      http.get('*/api/v1/teams/team-1/members', () => ok([member])),
      http.get('*/api/v1/teams/team-1/invitations', () => ok([])),
    )
    renderMembers(false)
    expect(await screen.findByText('admin@example.test')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '管理' })).toBeDisabled()
  })

  it('管理成员时最后管理员保护错误显示业务说明', async () => {
    server.use(
      http.get('*/api/v1/teams/team-1/members', () => ok([member])),
      http.get('*/api/v1/teams/team-1/invitations', () => ok([])),
      http.post('*/api/v1/teams/team-1/members/user-1/update', () =>
        HttpResponse.json({
          success: false,
          code: 'LAST_ADMIN_PROTECTED',
          message: '至少保留一位管理员',
          requestId: 'trace',
        }),
      ),
    )
    renderMembers(true)
    await userEvent.click(await screen.findByRole('button', { name: '管理' }))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '保存成员' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('至少保留一位正常管理员')
  })
})
