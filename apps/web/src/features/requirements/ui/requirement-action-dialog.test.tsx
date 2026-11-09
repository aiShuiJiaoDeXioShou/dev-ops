import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { createQueryClient } from '@/shared/api/query-client'
import { RequirementActionDialog } from './requirement-action-dialog'
import type { RequirementDetail } from '../model/types'

const requirement: RequirementDetail = {
  id: 'req-1',
  teamId: 'team-1',
  projectId: 'project-1',
  number: 1,
  title: '登录需求',
  status: 'in_development',
  devOwner: null,
  testOwner: null,
  version: 2,
  updatedAt: '2026-11-10T00:00:00.000Z',
  contentMode: 'markdown',
  contentMarkdown: '正文',
  externalUrl: null,
  externalSummary: null,
  acceptanceCriteria: null,
  collaborators: [],
  latestTestSubmission: null,
  linkedBugs: [],
  needsReview: false,
  linkedCodeReferences: [],
  createdAt: '2026-11-10T00:00:00.000Z',
  createdByUserId: 'user-1',
}

describe('RequirementActionDialog', () => {
  it('提测缺少测试负责人时本地校验阻止提交', async () => {
    render(
      <QueryClientProvider client={createQueryClient()}>
        <RequirementActionDialog
          requirement={requirement}
          action="submit-test"
          teamId="team-1"
          open
          onOpenChange={vi.fn()}
        />
      </QueryClientProvider>,
    )
    await userEvent.click(screen.getByRole('button', { name: '确认' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('请选择测试负责人')
  })

  it('原因类动作要求填写原因', async () => {
    render(
      <QueryClientProvider client={createQueryClient()}>
        <RequirementActionDialog
          requirement={requirement}
          action="withdraw-test"
          teamId="team-1"
          open
          onOpenChange={vi.fn()}
        />
      </QueryClientProvider>,
    )
    await userEvent.click(screen.getByRole('button', { name: '确认' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('请填写原因或结论')
  })
})
