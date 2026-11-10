import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { createQueryClient } from '@/shared/api/query-client'
import { server } from '@/test/server'
import { SkillForm } from './skill-form'

function ok(data: unknown) {
  return HttpResponse.json({ success: true, code: 'OK', message: 'ok', requestId: 'trace', data })
}

const createdSkill = {
  id: 'skill-1',
  teamId: 'team-1',
  name: '代码评审',
  identifier: 'code-review',
  category: 'engineering',
  contentVersion: '1.0.0',
  summary: '提交前检查风险',
  source: 'team',
  enabled: true,
  version: 1,
  content: '阅读变更，列出风险。',
  createdByUserId: 'user-1',
  createdAt: '2026-11-10T00:00:00.000Z',
  updatedAt: '2026-11-10T00:00:00.000Z',
}

function renderForm(onOpenChange = vi.fn()) {
  render(
    <QueryClientProvider client={createQueryClient()}>
      <SkillForm teamId="team-1" open onOpenChange={onOpenChange} />
    </QueryClientProvider>,
  )
  return onOpenChange
}

describe('SkillForm', () => {
  it('缺少字段与非法标识时阻止提交并提示', async () => {
    const user = userEvent.setup()
    renderForm()
    await user.click(screen.getByRole('button', { name: '发布到团队' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('请填写技能名称。')
    await user.type(screen.getByLabelText('名称'), '代码评审')
    await user.type(screen.getByLabelText('调用标识'), 'Code Review')
    await user.type(screen.getByLabelText('简述'), '简述')
    await user.type(screen.getByLabelText('SKILL.md 正文'), '指令内容')
    await user.click(screen.getByRole('button', { name: '发布到团队' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('调用标识只允许小写字母、数字和连字符。')
  })

  it('校验通过后提交并关闭弹窗', async () => {
    server.use(http.post('*/api/v1/teams/team-1/skills', () => ok(createdSkill)))
    const user = userEvent.setup()
    const onOpenChange = renderForm()
    await user.type(screen.getByLabelText('名称'), '代码评审')
    await user.type(screen.getByLabelText('调用标识'), 'code-review')
    await user.type(screen.getByLabelText('简述'), '提交前检查风险')
    await user.type(screen.getByLabelText('SKILL.md 正文'), '阅读变更，列出风险。')
    await user.click(screen.getByRole('button', { name: '发布到团队' }))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })
})
