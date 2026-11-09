import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { createQueryClient } from '@/shared/api/query-client'
import { server } from '@/test/server'
import { ProjectForm } from './project-form'

describe('ProjectForm', () => {
  it('空名称本地校验不提交', async () => {
    render(
      <QueryClientProvider client={createQueryClient()}>
        <ProjectForm teamId="team-1" open onOpenChange={() => undefined} />
      </QueryClientProvider>,
    )
    await userEvent.click(screen.getByRole('button', { name: '创建项目' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('请填写项目名称')
  })

  it('对话框支持 Escape 关闭并通知父级', async () => {
    const onOpenChange = vi.fn()
    render(
      <QueryClientProvider client={createQueryClient()}>
        <ProjectForm teamId="team-1" open onOpenChange={onOpenChange} />
      </QueryClientProvider>,
    )
    await screen.findByRole('dialog')
    await userEvent.keyboard('{Escape}')
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('业务冲突显示可读错误', async () => {
    server.use(
      http.post('*/api/v1/teams/team-1/projects', () =>
        HttpResponse.json({
          success: false,
          code: 'PRECONDITION_FAILED',
          message: '重复',
          requestId: 'trace',
        }),
      ),
    )
    render(
      <QueryClientProvider client={createQueryClient()}>
        <ProjectForm teamId="team-1" open onOpenChange={() => undefined} />
      </QueryClientProvider>,
    )
    await userEvent.type(screen.getByLabelText('项目名称'), '重复项目')
    await userEvent.click(screen.getByRole('button', { name: '创建项目' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('当前状态不允许该操作')
  })

  it('创建成功后关闭对话框并回调项目 ID', async () => {
    server.use(
      http.post('*/api/v1/teams/team-1/projects', () =>
        HttpResponse.json({
          success: true,
          code: 'OK',
          message: 'ok',
          requestId: 'trace',
          data: {
            id: 'project-1',
            teamId: 'team-1',
            name: '项目',
            description: null,
            owner: { userId: 'u', name: '用户' },
            status: 'active',
            counts: { openRequirements: 0, openBugs: 0 },
            version: 1,
            createdAt: '2026-11-10T00:00:00.000Z',
            updatedAt: '2026-11-10T00:00:00.000Z',
          },
        }),
      ),
    )
    const onOpenChange = vi.fn()
    const onCreated = vi.fn()
    render(
      <QueryClientProvider client={createQueryClient()}>
        <ProjectForm teamId="team-1" open onOpenChange={onOpenChange} onCreated={onCreated} />
      </QueryClientProvider>,
    )
    await userEvent.type(screen.getByLabelText('项目名称'), '项目')
    await userEvent.click(screen.getByRole('button', { name: '创建项目' }))
    expect(await screen.findByRole('heading', { name: '创建项目' })).toBeInTheDocument()
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(onCreated).toHaveBeenCalledWith('project-1')
  })
})
