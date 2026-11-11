import { QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http } from 'msw'
import { MemoryRouter, Route, Routes } from 'react-router'
import { describe, expect, it } from 'vitest'
import { SessionProvider } from '@/features/identity/public'
import { createQueryClient } from '@/shared/api/query-client'
import { server, success, teamFixture } from '@/test/server'
import { Component as ChangePlansPage } from './change-plans-page'
import { Component as ChangePlanPage } from './change-plan-page'

const planFixture = {
  id: 'plan-1',
  projectId: 'project-1',
  serviceId: 'service-1',
  targetResource: 'web',
  environment: 'test',
  operationKind: 'deploy_version',
  status: 'pending',
  revision: 1,
  versionLabel: 'v1.4.0',
  scopeSummary: '部署测试环境',
  evidence: '流水线通过',
  rollbackPlan: '回滚上一版本',
  executionMode: 'platform_pipeline',
  workflowPath: '.devops/workflows/deploy-test.yml',
  workflowRef: 'main',
  approvedBy: null,
  approvedAt: null,
  approvedRevision: null,
  activeExecutionId: null,
  startedAt: null,
  completedAt: null,
  errorCode: null,
  errorMessage: null,
  createdBy: { userId: 'user-1', name: '测试用户', status: 'active', available: true },
  createdAt: '2026-11-11T02:00:00.000Z',
  updatedAt: '2026-11-11T02:00:00.000Z',
  version: 1,
}

function renderAt(path: string, element: React.ReactElement) {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <SessionProvider initialUser={{ id: 'user-1', name: '测试用户', email: 'user@example.test' }}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/operations/changes" element={element} />
            <Route path="/operations/changes/:planId" element={element} />
          </Routes>
        </MemoryRouter>
      </SessionProvider>
    </QueryClientProvider>,
  )
}

describe('变更计划页面', () => {
  it('列出变更计划并显示状态', async () => {
    server.use(
      http.get('*/api/v1/teams/:teamId/change-plans', () =>
        success({ items: [planFixture], page: 1, pageSize: 20, total: 1 }),
      ),
    )
    renderAt('/operations/changes', <ChangePlansPage />)
    expect(await screen.findByRole('link', { name: /web · v1\.4\.0/ })).toBeTruthy()
    expect(screen.getAllByText('待确认').length).toBeGreaterThan(0)
  })

  it('详情页按服务端 actions 展示动作并在放行时提交修订号', async () => {
    let approveBody = ''
    server.use(
      http.get('*/api/v1/change-plans/:planId', () =>
        success({
          plan: planFixture,
          approval: null,
          executions: [],
          events: [],
          actions: {
            canUpdate: false,
            canApprove: true,
            canExecute: false,
            canVerify: false,
            canCancel: true,
            canRetry: false,
          },
        }),
      ),
      http.post('*/api/v1/change-plans/:planId/approve', async ({ request }) => {
        approveBody = await request.text()
        return success({
          plan: { ...planFixture, status: 'approved' },
          approval: {
            id: 'approval-1',
            revision: 1,
            approvedBy: { userId: 'user-1', name: '测试用户', status: 'active', available: true },
            approvedAt: '2026-11-11T02:01:00.000Z',
            invalidatedAt: null,
          },
          executions: [],
          events: [],
          actions: {
            canUpdate: false,
            canApprove: false,
            canExecute: true,
            canVerify: false,
            canCancel: true,
            canRetry: false,
          },
        })
      }),
    )
    renderAt('/operations/changes/plan-1', <ChangePlanPage />)
    fireEvent.click(await screen.findByRole('button', { name: '放行' }))
    fireEvent.click(await screen.findByRole('button', { name: '确认' }))
    await waitFor(() => expect(approveBody).toContain('"expectedRevision":1'))
  })

  it('无匹配时显示清除筛选入口', async () => {
    server.use(
      http.get('*/api/v1/teams/:teamId/change-plans', () => success({ items: [], page: 1, pageSize: 20, total: 0 })),
    )
    renderAt('/operations/changes?status=failed', <ChangePlansPage />)
    expect(await screen.findByText('没有匹配的变更计划')).toBeTruthy()
    expect(screen.getByRole('button', { name: '清除筛选' })).toBeTruthy()
  })

  it('只读详情展示事件时间线且不显示写动作', async () => {
    server.use(
      http.get('*/api/v1/change-plans/:planId', () =>
        success({
          plan: { ...planFixture, status: 'completed' },
          approval: null,
          executions: [],
          events: [
            {
              id: 'event-1',
              eventType: 'completed',
              actor: { userId: 'user-1', name: '测试用户', status: 'active', available: true },
              summary: '验证通过，变更完成',
              payload: null,
              createdAt: '2026-11-11T02:02:00.000Z',
            },
          ],
          actions: {
            canUpdate: false,
            canApprove: false,
            canExecute: false,
            canVerify: false,
            canCancel: false,
            canRetry: false,
          },
        }),
      ),
    )
    renderAt('/operations/changes/plan-1', <ChangePlanPage />)
    expect(await screen.findByText(/验证通过，变更完成/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: '放行' })).toBeNull()
    expect(screen.queryByRole('button', { name: '执行' })).toBeNull()
  })

  it('团队加载完成后展示项目上下文', () => {
    expect(teamFixture.role).toBe('admin')
  })
})
