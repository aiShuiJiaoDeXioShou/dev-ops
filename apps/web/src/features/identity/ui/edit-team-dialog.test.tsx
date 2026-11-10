import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { createQueryClient } from '@/shared/api/query-client'
import { SessionProvider } from '@/features/identity/public'
import { sessionFixture } from '@/test/server'
import { ToastProvider } from '@/shared/ui/toast'
import { EditTeamDialog } from './edit-team-dialog'

describe('EditTeamDialog', () => {
  it('打开时展示当前团队资料字段', async () => {
    render(
      <QueryClientProvider client={createQueryClient()}>
        <SessionProvider initialUser={sessionFixture.user}>
          <ToastProvider>
            <EditTeamDialog open onOpenChange={() => undefined} />
          </ToastProvider>
        </SessionProvider>
      </QueryClientProvider>,
    )
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(screen.getByLabelText('团队名称')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '保存团队资料' })).toBeInTheDocument()
  })
})
