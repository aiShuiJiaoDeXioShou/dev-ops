import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { createQueryClient } from '@/shared/api/query-client'
import { ToastProvider } from '@/shared/ui/toast'
import { server } from '@/test/server'
import { InviteMemberDialog } from './invite-member-dialog'

describe('InviteMemberDialog', () => {
  it('重复邀请同一邮箱时显示具体原因而不是通用状态错误', async () => {
    server.use(
      http.post('*/api/v1/teams/team-1/invitations', () =>
        HttpResponse.json({
          success: false,
          code: 'DUPLICATE_RELATION',
          message: '该邮箱已有待接受邀请',
          requestId: 'trace',
        }),
      ),
    )
    render(
      <QueryClientProvider client={createQueryClient()}>
        <ToastProvider>
          <InviteMemberDialog teamId="team-1" open onOpenChange={() => undefined} />
        </ToastProvider>
      </QueryClientProvider>,
    )
    await userEvent.type(screen.getByLabelText('邮箱'), 'member@example.test')
    await userEvent.click(screen.getByRole('button', { name: '发送邀请' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('该邮箱已有待接受邀请')
    expect(screen.getByRole('alert')).not.toHaveTextContent('当前状态不允许该操作')
    expect(document.querySelector('#toast[data-variant="error"] .toast-icon')).toBeInTheDocument()
  })
})
