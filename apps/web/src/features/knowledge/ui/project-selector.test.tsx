import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { createQueryClient } from '@/shared/api/query-client'
import { SessionProvider } from '@/features/identity/public'
import { server } from '@/test/server'
import { ProjectSelector } from './project-selector'

function ok(data: unknown) {
  return HttpResponse.json({ success: true, code: 'OK', message: 'ok', requestId: 'trace', data })
}

function renderSelector() {
  render(
    <QueryClientProvider client={createQueryClient()}>
      <SessionProvider initialUser={{ id: 'user-1', name: '管理员', email: 'admin@example.test' }}>
        <ProjectSelector teamId="team-1" templateId="template-1" />
      </SessionProvider>
    </QueryClientProvider>,
  )
}

describe('ProjectSelector', () => {
  it('浏览者只读展示当前选用状态', async () => {
    server.use(
      http.get('*/api/v1/me/teams', () =>
        ok({ teams: [{ id: 'team-1', name: '测试团队', role: 'viewer', status: 'active' }], isPlatformAdmin: false }),
      ),
      http.get('*/api/v1/projects/project-1/agent-template', () =>
        ok({
          selection: {
            templateId: 'template-1',
            templateName: '默认协作约定',
            contentVersion: 2,
            selectedByUserId: 'user-1',
            updatedAt: '2026-11-10T00:00:00.000Z',
          },
          version: 1,
        }),
      ),
    )
    renderSelector()
    expect(await screen.findByText('当前项目选用：默认协作约定')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '应用到项目' })).not.toBeInTheDocument()
  })

  it('管理员可选用模板并刷新状态', async () => {
    let applied = false
    server.use(
      http.get('*/api/v1/projects/project-1/agent-template', () =>
        ok({
          selection: applied
            ? {
                templateId: 'template-1',
                templateName: '默认协作约定',
                contentVersion: 2,
                selectedByUserId: 'user-1',
                updatedAt: '2026-11-10T00:00:00.000Z',
              }
            : null,
          version: applied ? 1 : 0,
        }),
      ),
      http.post('*/api/v1/projects/project-1/agent-template/apply', () => {
        applied = true
        return ok({ selection: null, version: 1 })
      }),
    )
    const user = userEvent.setup()
    renderSelector()
    await user.click(await screen.findByRole('button', { name: '应用到项目' }))
    await waitFor(() => expect(applied).toBe(true))
  })
})
