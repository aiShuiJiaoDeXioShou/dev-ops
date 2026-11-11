import { render, screen } from '@testing-library/react'
import type { ApiSuccessData } from '@dev-ops/api-client'
import { describe, expect, it } from 'vitest'
import { ActivityBarometer } from './activity-barometer'

const days = [
  { date: '2026-11-09', total: 3, counts: { activity: 2, code: 1, pullRequest: 0 } },
  { date: '2026-11-10', total: 1, counts: { activity: 1, code: 0, pullRequest: 0 } },
]

const activityFixture: ApiSuccessData<'/api/v1/teams/{teamId}/project-activity', 'get'> = {
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
  it('渲染热力图总数与项目摘要，未同步来源显示未知', () => {
    render(
      <ActivityBarometer
        result={activityFixture}
        isPending={false}
        isError={false}
        error={null}
        source="all"
        onSourceChange={() => undefined}
      />,
    )
    expect(screen.getByText(/过去一年 · 4 次活动/)).toBeInTheDocument()
    expect(screen.getByText(/PR 未同步/)).toBeInTheDocument()
  })

  it('已有结果时刷新失败保留上一份热力图并提示静默失败', () => {
    render(
      <ActivityBarometer
        result={activityFixture}
        isPending={false}
        isError
        error={new Error('超时')}
        source="all"
        onSourceChange={() => undefined}
      />,
    )
    expect(screen.getByText(/过去一年 · 4 次活动/)).toBeInTheDocument()
    expect(screen.getByText(/晴雨表刷新失败/)).toBeInTheDocument()
  })
})
