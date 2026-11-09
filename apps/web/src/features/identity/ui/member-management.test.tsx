import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { createQueryClient } from '@/shared/api/query-client'
import { server } from '@/test/server'
import { MemberManagement } from './member-management'

const member = {
  userId: 'user-1',
  name: '管理员',
  email: 'admin@example.test',
  role: 'admin',
  status: 'active',
  joinedAt: '2026-11-10T00:00:00.000Z',
}

describe('MemberManagement', () => {
  it('浏览者只读时操作按钮禁用', async () => {
    server.use(
      http.get('*/api/v1/teams/team-1/members', () =>
        HttpResponse.json({ success: true, code: 'OK', message: 'ok', requestId: 'trace', data: [member] }),
      ),
      http.get('*/api/v1/teams/team-1/invitations', () =>
        HttpResponse.json({ success: true, code: 'OK', message: 'ok', requestId: 'trace', data: [] }),
      ),
    )
    render(
      <QueryClientProvider client={createQueryClient()}>
        <MemberManagement teamId="team-1" canManage={false} />
      </QueryClientProvider>,
    )
    expect(await screen.findByText('admin@example.test')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '停用' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '邀请成员' })).toBeDisabled()
  })

  it('最后管理员保护错误显示业务说明', async () => {
    server.use(
      http.get('*/api/v1/teams/team-1/members', () =>
        HttpResponse.json({ success: true, code: 'OK', message: 'ok', requestId: 'trace', data: [member] }),
      ),
      http.get('*/api/v1/teams/team-1/invitations', () =>
        HttpResponse.json({ success: true, code: 'OK', message: 'ok', requestId: 'trace', data: [] }),
      ),
      http.post('*/api/v1/teams/team-1/members/user-1/update', () =>
        HttpResponse.json({
          success: false,
          code: 'LAST_ADMIN_PROTECTED',
          message: '至少保留一位管理员',
          requestId: 'trace',
        }),
      ),
    )
    render(
      <QueryClientProvider client={createQueryClient()}>
        <MemberManagement teamId="team-1" canManage />
      </QueryClientProvider>,
    )
    await userEvent.click(await screen.findByRole('button', { name: '停用' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('至少保留一位正常管理员')
  })
})
