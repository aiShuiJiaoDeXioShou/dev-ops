import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SessionProvider } from '@/features/identity/public'
import { createQueryClient } from '@/shared/api/query-client'
import { sessionFixture } from '@/test/server'
import { ToastProvider } from '@/shared/ui/toast'
import { TeamProfileForm } from './team-profile-form'

describe('TeamProfileForm', () => {
  it('管理员看到可编辑的团队资料表单', async () => {
    render(
      <QueryClientProvider client={createQueryClient()}>
        <SessionProvider initialUser={sessionFixture.user}>
          <ToastProvider>
            <TeamProfileForm />
          </ToastProvider>
        </SessionProvider>
      </QueryClientProvider>,
    )
    const name = await screen.findByLabelText('团队名称')
    expect(name).not.toHaveAttribute('readonly')
    expect(screen.getByRole('button', { name: '保存团队资料' })).toBeInTheDocument()
  })
})
