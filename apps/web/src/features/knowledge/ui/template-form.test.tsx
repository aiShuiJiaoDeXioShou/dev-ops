import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { createQueryClient } from '@/shared/api/query-client'
import { server } from '@/test/server'
import { TemplateForm } from './template-form'

const template = {
  id: 'template-1',
  teamId: 'team-1',
  name: '默认协作约定',
  tag: '团队',
  description: '默认约定',
  excerpt: '# AGENTS.md',
  contentVersion: 1,
  version: 1,
  selectedProjectCount: 0,
  content: '# AGENTS.md',
  createdByUserId: 'user-1',
  createdAt: '2026-11-10T00:00:00.000Z',
  updatedAt: '2026-11-10T00:00:00.000Z',
}

function ok(data: unknown) {
  return HttpResponse.json({ success: true, code: 'OK', message: 'ok', requestId: 'trace', data })
}

function renderForm(onOpenChange = vi.fn()) {
  render(
    <QueryClientProvider client={createQueryClient()}>
      <TemplateForm teamId="team-1" open onOpenChange={onOpenChange} />
    </QueryClientProvider>,
  )
  return onOpenChange
}

describe('TemplateForm', () => {
  it('名称与正文为空时阻止提交', async () => {
    const user = userEvent.setup()
    renderForm()
    await user.click(screen.getByRole('button', { name: '保存模板' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('请填写模板名称。')
  })

  it('创建模板成功后关闭弹窗', async () => {
    server.use(http.post('*/api/v1/teams/team-1/agent-templates', () => ok(template)))
    const user = userEvent.setup()
    const onOpenChange = renderForm()
    await user.type(screen.getByLabelText('名称'), '默认协作约定')
    await user.type(screen.getByLabelText('AGENTS.md 正文'), '# AGENTS.md')
    await user.click(screen.getByRole('button', { name: '保存模板' }))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  it('副本模式只要求名称', async () => {
    server.use(
      http.post('*/api/v1/agent-templates/template-1/duplicate', () =>
        ok({ ...template, id: 'template-2', name: '默认协作约定 副本' }),
      ),
    )
    const user = userEvent.setup()
    render(
      <QueryClientProvider client={createQueryClient()}>
        <TemplateForm teamId="team-1" open onOpenChange={vi.fn()} template={template} duplicate />
      </QueryClientProvider>,
    )
    expect(screen.queryByLabelText('AGENTS.md 正文')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '保存模板' }))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })
})
