import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { ActivityTimeline } from './activity-timeline'
import { VersionHistory } from './version-history'

describe('知识资产历史视图', () => {
  it('版本历史可加载并展示历史正文', async () => {
    const user = userEvent.setup()
    render(
      <VersionHistory
        items={[{ id: 'v1', label: 'v1.0.0', createdAt: '2026-11-10T00:00:00.000Z', createdByUserId: 'user-1' }]}
        loadContent={() => Promise.resolve('历史正文')}
      />,
    )
    await user.click(screen.getByRole('button', { name: '查看正文' }))
    expect(await screen.findByText('历史正文')).toBeInTheDocument()
  })

  it('活动记录显示中文动作并区分空状态', () => {
    render(
      <ActivityTimeline
        items={[
          {
            id: 'a1',
            action: 'skill_updated',
            actorUserId: 'user-1',
            changes: { contentVersion: '1.1.0' },
            reason: null,
            note: null,
            createdAt: '2026-11-10T00:00:00.000Z',
          },
        ]}
      />,
    )
    expect(screen.getByText('编辑技能')).toBeInTheDocument()
    expect(screen.getByText(/操作者 user-1/)).toBeInTheDocument()
  })
})
