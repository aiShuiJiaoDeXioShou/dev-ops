import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { http } from 'msw'
import { MemoryRouter, Route, Routes } from 'react-router'
import { describe, expect, it } from 'vitest'
import { createQueryClient } from '@/shared/api/query-client'
import { server, success } from '@/test/server'
import { Component } from './pipelines-page'

describe('pipelines-page', () => {
  it('无运行记录时显示空状态且不提供触发入口', async () => {
    server.use(
      http.get('*/api/v1/projects/project-1/pipeline-runs', () =>
        success({ items: [], page: 1, pageSize: 20, total: 0 }),
      ),
    )
    render(
      <QueryClientProvider client={createQueryClient()}>
        <MemoryRouter initialEntries={['/projects/project-1/pipelines']}>
          <Routes>
            <Route path="/projects/:projectId/pipelines" element={<Component />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )
    expect(await screen.findByText('暂无流水线运行')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /触发|重跑|取消/ })).not.toBeInTheDocument()
  })
})
