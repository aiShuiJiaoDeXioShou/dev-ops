import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { SessionProvider } from '@/features/identity/model/session'
import { createQueryClient } from '@/shared/api/query-client'
import { server } from '@/test/server'
import { Component as BotPromptTemplatesPage } from './bot-prompt-templates-page'

const templates = [
  {
    id: 'tpl-1',
    teamId: 'team-1',
    name: 'review-plan',
    description: '评审技术方案与边界风险',
    body: '请评审以下方案：\n$ARGUMENTS\n列出风险与建议。',
    updatedAt: '2026-11-24T08:00:00.000Z',
  },
  {
    id: 'tpl-2',
    teamId: 'team-1',
    name: 'daily-standup',
    description: '生成简洁站会摘要',
    body: '汇总最近 24 小时的需求与 PR 进展。',
    updatedAt: '2026-11-23T08:00:00.000Z',
  },
]

function ok(data: unknown) {
  return HttpResponse.json({ success: true, code: 'OK', message: 'ok', requestId: 'trace', data })
}

function renderPage(initialEntry = '/capabilities/prompt-templates') {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <SessionProvider initialUser={{ id: 'user-1', name: '管理员', email: 'admin@example.test' }}>
        <MemoryRouter initialEntries={[initialEntry]}>
          <BotPromptTemplatesPage />
        </MemoryRouter>
      </SessionProvider>
    </QueryClientProvider>,
  )
}

describe('BotPromptTemplatesPage', () => {
  it('展示卡片正文预览、参数筛选以及右侧 $ARGUMENTS 实时试填预览', async () => {
    server.use(
      http.get('*/api/v1/teams/team-1/bot-prompt-templates', () => ok({ items: templates, nextCursor: null })),
    )
    const user = userEvent.setup()
    renderPage()

    expect((await screen.findAllByText('/review-plan')).length).toBeGreaterThan(0)
    expect(screen.getAllByText('评审技术方案与边界风险').length).toBeGreaterThanOrEqual(2)

    const sampleInput = screen.getByPlaceholderText('输入测试参数，实时查看替换后的提示词…')
    await user.type(sampleInput, '重构技能库')
    expect(screen.getByText(/请评审以下方案：\s*重构技能库/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '纯指令' }))
    expect(screen.queryByText('评审技术方案与边界风险')).not.toBeInTheDocument()
    expect(screen.getAllByText('生成简洁站会摘要').length).toBeGreaterThan(0)
  })

  it('打开双栏编辑弹窗后可实时预览 / 命令并插入 $ARGUMENTS', async () => {
    server.use(
      http.get('*/api/v1/teams/team-1/bot-prompt-templates', () => ok({ items: templates, nextCursor: null })),
    )
    const user = userEvent.setup()
    renderPage()

    await screen.findAllByText('评审技术方案与边界风险')
    await user.click(screen.getByRole('button', { name: '编辑 /review-plan' }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toBeInTheDocument()
    expect(screen.getByLabelText('会话命令菜单预览')).toHaveTextContent('/review-plan')
  })

  it('浏览者只读模式不显示新建与删除入口', async () => {
    server.use(
      http.get('*/api/v1/teams/team-1/bot-prompt-templates', () => ok({ items: templates, nextCursor: null })),
      http.get('*/api/v1/me/teams', () =>
        ok({ teams: [{ id: 'team-1', name: '测试团队', role: 'viewer', status: 'active' }], isPlatformAdmin: false }),
      ),
    )
    renderPage()
    await screen.findAllByText('评审技术方案与边界风险')
    expect(screen.queryByRole('button', { name: /新建模板/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '删除' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '查看 /review-plan' })).toBeInTheDocument()
  })
})
