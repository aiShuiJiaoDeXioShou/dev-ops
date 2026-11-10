import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { createQueryClient } from '@/shared/api/query-client'
import { SessionProvider } from '@/features/identity/public'
import { server } from '@/test/server'
import { SkillList } from './skill-list'

const skillPage = {
  items: [
    {
      id: 'skill-1',
      name: '代码评审',
      identifier: 'code-review',
      category: 'engineering',
      contentVersion: '1.1.0',
      summary: '提交前检查风险',
      source: 'team',
      enabled: true,
      version: 2,
      updatedAt: '2026-11-10T00:00:00.000Z',
    },
  ],
  page: 1,
  pageSize: 20,
  total: 1,
}

function ok(data: unknown) {
  return HttpResponse.json({ success: true, code: 'OK', message: 'ok', requestId: 'trace', data })
}

const skillsHandler = http.get('*/api/v1/teams/team-1/skills', () => ok(skillPage))

function renderList() {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <SessionProvider initialUser={{ id: 'user-1', name: '管理员', email: 'admin@example.test' }}>
        <MemoryRouter initialEntries={['/capabilities/skills']}>
          <SkillList teamId="team-1" />
        </MemoryRouter>
      </SessionProvider>
    </QueryClientProvider>,
  )
}

describe('SkillList', () => {
  it('展示技能卡片与调用标识', async () => {
    server.use(skillsHandler)
    renderList()
    expect((await screen.findAllByText('代码评审')).length).toBeGreaterThan(0)
    expect(screen.getByText('@skill/code-review')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /发布 Skill/ })).toBeEnabled()
  })

  it('浏览者不显示发布入口', async () => {
    server.use(
      skillsHandler,
      http.get('*/api/v1/me/teams', () => ok([{ id: 'team-1', name: '测试团队', role: 'viewer', status: 'active' }])),
    )
    renderList()
    await screen.findByText('代码评审')
    expect(screen.queryByRole('button', { name: /发布 Skill/ })).not.toBeInTheDocument()
  })

  it('搜索无结果时提供清除筛选', async () => {
    server.use(http.get('*/api/v1/teams/team-1/skills', () => ok({ items: [], page: 1, pageSize: 20, total: 0 })))
    const user = userEvent.setup()
    renderList()
    expect(await screen.findByText('还没有团队 Skill')).toBeInTheDocument()
    await user.type(screen.getByLabelText('搜索技能'), '缺失')
    expect(await screen.findByText('没有符合条件的技能')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '清除筛选' })).toBeInTheDocument()
  })
})
