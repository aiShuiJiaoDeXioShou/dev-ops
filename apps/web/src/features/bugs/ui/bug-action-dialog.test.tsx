import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { createQueryClient } from '@/shared/api/query-client'
import { BugActionDialog } from './bug-action-dialog'
import type { BugDetail } from '../model/types'

const bug: BugDetail = {
  id: 'bug-1',
  teamId: 'team-1',
  projectId: 'project-1',
  number: 1,
  title: '登录闪退',
  status: 'in_fix',
  fixOwner: null,
  regressionOwner: null,
  version: 2,
  updatedAt: '2026-11-10T00:00:00.000Z',
  phenomenon: '闪退',
  expectedBehavior: '正常',
  reproduction: '步骤',
  reproductionUnknown: false,
  evidenceText: null,
  evidenceUrl: null,
  createdByUserId: 'user-1',
  createdAt: '2026-11-10T00:00:00.000Z',
  linkedRequirements: [],
  regressions: [],
  linkedCodeReferences: [],
}

describe('BugActionDialog', () => {
  it('提交回归缺少修复说明时本地校验阻止提交', async () => {
    render(
      <QueryClientProvider client={createQueryClient()}>
        <BugActionDialog bug={bug} action="submit-regression" teamId="team-1" open onOpenChange={vi.fn()} />
      </QueryClientProvider>,
    )
    await userEvent.click(screen.getByRole('button', { name: '确认' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('请填写修复说明')
  })

  it('关闭 Bug 必须填写说明', async () => {
    render(
      <QueryClientProvider client={createQueryClient()}>
        <BugActionDialog bug={bug} action="close" teamId="team-1" open onOpenChange={vi.fn()} />
      </QueryClientProvider>,
    )
    await userEvent.click(screen.getByRole('button', { name: '确认' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('请填写关闭说明')
  })
})
