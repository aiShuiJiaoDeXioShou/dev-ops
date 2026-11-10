import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { http } from 'msw'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { createQueryClient } from '@/shared/api/query-client'
import { server, success } from '@/test/server'
import { ActivityBarometer } from './activity-barometer'

const days = [
  { date: '2026-11-09', total: 3, counts: { activity: 2, code: 1, pullRequest: 0 } },
  { date: '2026-11-10', total: 1, counts: { activity: 1, code: 0, pullRequest: 0 } },
]

const activityFixture = {
  timezone: 'UTC',
  from: '2025-11-05',
  to: '2026-11-10',
  source: 'all',
  sourceStatus: { activity: 'ok', code: 'unknown', pullRequest: 'unknown' },
  days,
  projects: [
    {
      projectId: 'project-1',
      status: 'active',
      owner: { userId: 'user-1', name: '测试用户', available: true },
      items: { total: 4, completed: 2 },
      pendingRequirements: 1,
      pendingBugs: 1,
      pendingPullRequests: null,
      bots: null,
    },
  ],
}

describe('ActivityBarometer', () => {
  it('渲染热力图总数与项目摘要，未同步来源显示未知', async () => {
    server.use(http.get('*/api/v1/teams/team-1/project-activity', () => success(activityFixture)))
    render(
      <QueryClientProvider client={createQueryClient()}>
        <MemoryRouter>
          <ActivityBarometer teamId="team-1" search="" status="" />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    expect(await screen.findByText(/共 4 次活动/)).toBeInTheDocument()
    expect(screen.getByText('完成 2/4')).toBeInTheDocument()
    expect(screen.getByText('待审 PR 未知')).toBeInTheDocument()
    expect(screen.getByText(/PR 未同步/)).toBeInTheDocument()
  })
})
