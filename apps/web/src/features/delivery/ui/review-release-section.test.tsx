import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { http } from 'msw'
import { describe, expect, it } from 'vitest'
import { SessionProvider } from '@/features/identity/public'
import { createQueryClient } from '@/shared/api/query-client'
import { ToastProvider } from '@/shared/ui/toast'
import { server, success, sessionFixture } from '@/test/server'
import { ReviewReleaseSection } from './review-release-section'

const review = {
  id: 'review-1',
  projectId: 'project-1',
  serviceId: null,
  targetType: 'mini_program',
  versionLabel: '1.0.0',
  reviewPlatform: 'wechat',
  submittedAt: '2026-11-10T08:00:00.000Z',
  submittedBy: { userId: 'user-1', name: '测试用户' },
  note: null,
  evidenceUrl: null,
  reviewStatus: 'approved',
  reviewReason: null,
  reviewedAt: '2026-11-10T09:00:00.000Z',
  version: 2,
  createdAt: '2026-11-10T08:00:00.000Z',
  updatedAt: '2026-11-10T09:00:00.000Z',
}

describe('ReviewReleaseSection', () => {
  it('分别展示审核通过与尚未发布，不把审核通过当成已发布', async () => {
    server.use(
      http.get('*/api/v1/projects/project-1/reviews', () =>
        success({ items: [review], page: 1, pageSize: 50, total: 1 }),
      ),
      http.get('*/api/v1/projects/project-1/releases', () =>
        success({ items: [], page: 1, pageSize: 50, total: 0 }),
      ),
    )
    render(
      <QueryClientProvider client={createQueryClient()}>
        <SessionProvider initialUser={sessionFixture.user}>
          <ToastProvider>
            <ReviewReleaseSection projectId="project-1" />
          </ToastProvider>
        </SessionProvider>
      </QueryClientProvider>,
    )
    expect(await screen.findByText('已通过')).toBeInTheDocument()
    expect(await screen.findByText(/尚未记录实际发布/)).toBeInTheDocument()
  })
})
