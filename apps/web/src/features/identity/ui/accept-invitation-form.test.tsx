import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { MemoryRouter, Route, Routes } from 'react-router'
import { describe, expect, it } from 'vitest'
import { createQueryClient } from '@/shared/api/query-client'
import { server } from '@/test/server'
import { AcceptInvitationForm } from './accept-invitation-form'

const invitation = {
  teamName: '测试团队',
  email: 'new@example.test',
  role: 'developer',
  expiresAt: '2099-01-01T00:00:00.000Z',
}

describe('AcceptInvitationForm', () => {
  it('邀请无效时显示明确提示', async () => {
    server.use(
      http.get('*/api/v1/invitations/bad-token', () =>
        HttpResponse.json({ success: false, code: 'INVITATION_INVALID', message: '邀请失效', requestId: 'trace' }),
      ),
    )
    render(
      <QueryClientProvider client={createQueryClient()}>
        <MemoryRouter initialEntries={['/accept-invitation?token=bad-token']}>
          <AcceptInvitationForm />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    expect(await screen.findByRole('alert')).toHaveTextContent('邀请无效或已过期')
  })

  it('接受邀请成功后进入项目页', async () => {
    server.use(
      http.get('*/api/v1/invitations/good-token', () =>
        HttpResponse.json({ success: true, code: 'OK', message: 'ok', requestId: 'trace', data: invitation }),
      ),
      http.post('*/api/v1/invitations/good-token/accept', () =>
        HttpResponse.json({
          success: true,
          code: 'OK',
          message: 'ok',
          requestId: 'trace',
          data: { userId: 'u', teamId: 't', teamName: '测试团队', role: 'developer' },
        }),
      ),
    )
    render(
      <QueryClientProvider client={createQueryClient()}>
        <MemoryRouter initialEntries={['/accept-invitation?token=good-token']}>
          <Routes>
            <Route path="/accept-invitation" element={<AcceptInvitationForm />} />
            <Route path="/projects" element={<h1>项目首页</h1>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )
    await userEvent.type(await screen.findByLabelText('显示名称'), '新成员')
    await userEvent.type(screen.getByLabelText('设置密码'), 'password-123')
    await userEvent.type(screen.getByLabelText('确认密码'), 'password-123')
    await userEvent.click(screen.getByRole('button', { name: '加入团队' }))
    expect(await screen.findByRole('heading', { name: '项目首页' })).toBeInTheDocument()
  })
})
