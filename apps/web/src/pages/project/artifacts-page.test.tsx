import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { http } from 'msw'
import { MemoryRouter, Route, Routes } from 'react-router'
import { describe, expect, it } from 'vitest'
import userEvent from '@testing-library/user-event'
import { SessionProvider } from '@/features/identity/public'
import { createQueryClient } from '@/shared/api/query-client'
import { server, sessionFixture, success } from '@/test/server'
import { Component as ArtifactsPage } from './artifacts-page'

describe('artifacts-page', () => {
  it('无服务与产物时分别显示空状态', async () => {
    server.use(
      http.get('*/api/v1/projects/project-1/services', () => success([])),
      http.get('*/api/v1/projects/project-1/artifacts', () => success({ items: [], page: 1, pageSize: 50, total: 0 })),
      http.get('*/api/v1/projects/project-1/reviews', () => success({ items: [], page: 1, pageSize: 50, total: 0 })),
      http.get('*/api/v1/projects/project-1/releases', () => success({ items: [], page: 1, pageSize: 50, total: 0 })),
    )
    render(
      <QueryClientProvider client={createQueryClient()}>
        <SessionProvider initialUser={sessionFixture.user}>
          <MemoryRouter initialEntries={['/projects/project-1/artifacts']}>
            <Routes>
              <Route path="/projects/:projectId/artifacts" element={<ArtifactsPage />} />
            </Routes>
          </MemoryRouter>
        </SessionProvider>
      </QueryClientProvider>,
    )
    expect(await screen.findByText('还没有构建产物')).toBeInTheDocument()
  })

  it('展示三环境运行版本并打开确认弹窗', async () => {
    server.use(
      http.get('*/api/v1/projects/project-1/services', () =>
        success([{ id: 'service-1', name: 'Web', status: 'active', description: null, version: 1, repositories: [] }]),
      ),
      http.get('*/api/v1/projects/project-1/services/service-1/run-versions', () =>
        success({
          items: [
            {
              serviceId: 'service-1',
              environment: 'test',
              version: 1,
              versionLabel: null,
              verificationStatus: 'unknown',
              confirmedAt: null,
              updatedAt: null,
              source: 'manual',
            },
          ],
          page: 1,
          pageSize: 3,
          total: 3,
        }),
      ),
      http.get('*/api/v1/projects/project-1/artifacts', () => success({ items: [], page: 1, pageSize: 50, total: 0 })),
      http.get('*/api/v1/projects/project-1/reviews', () => success({ items: [], page: 1, pageSize: 50, total: 0 })),
      http.get('*/api/v1/projects/project-1/releases', () => success({ items: [], page: 1, pageSize: 50, total: 0 })),
    )
    render(
      <QueryClientProvider client={createQueryClient()}>
        <SessionProvider initialUser={sessionFixture.user}>
          <MemoryRouter initialEntries={['/projects/project-1/artifacts']}>
            <Routes>
              <Route path="/projects/:projectId/artifacts" element={<ArtifactsPage />} />
            </Routes>
          </MemoryRouter>
        </SessionProvider>
      </QueryClientProvider>,
    )
    const confirmButton = await screen.findByRole('button', { name: '确认/更正' })
    await userEvent.click(confirmButton)
    expect(await screen.findByText('确认运行版本')).toBeInTheDocument()
  })
})
