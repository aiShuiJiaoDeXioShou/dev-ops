import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { http } from 'msw'
import { describe, expect, it } from 'vitest'
import { SessionProvider } from '@/features/identity/public'
import { createQueryClient } from '@/shared/api/query-client'
import { server, sessionFixture, success } from '@/test/server'
import { ToastProvider } from '@/shared/ui/toast'
import { ServiceManagement } from './service-management'

describe('ServiceManagement', () => {
  it('管理员可看到新增入口，空服务显示说明', async () => {
    server.use(http.get('*/api/v1/projects/project-1/services', () => success([])))
    render(
      <QueryClientProvider client={createQueryClient()}>
        <SessionProvider initialUser={sessionFixture.user}>
          <ToastProvider>
            <ServiceManagement projectId="project-1" />
          </ToastProvider>
        </SessionProvider>
      </QueryClientProvider>,
    )
    expect(await screen.findByText(/尚无服务/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '新增服务' })).toBeInTheDocument()
  })
})
