import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { EmptyState } from './page-state'

describe('EmptyState', () => {
  it('团队场景使用多 Bot 群组插画', () => {
    const { container } = render(<EmptyState mascot="group" title="还没有加入团队" description="邀请后开始协作" />)
    expect(screen.getByRole('heading', { name: '还没有加入团队' })).toBeInTheDocument()
    expect(container.querySelectorAll('.empty-art-group img')).toHaveLength(3)
  })

  it('项目场景使用项目卡片与 Bot 组合插画', () => {
    const { container } = render(<EmptyState mascot="project" title="还没有项目" description="创建第一个项目" />)
    expect(container.querySelector('.empty-project-preview')).toBeInTheDocument()
    expect(container.querySelector('.empty-art-project img')?.getAttribute('src')).toContain('bot-orbit-live.svg')
  })

  it('搜索无结果使用线性图标而不是吉祥物', () => {
    const { container } = render(
      <EmptyState icon={<span>search-icon</span>} title="没有结果" description="换个关键词" />,
    )
    expect(container.querySelector('.empty-art-icon')).toBeInTheDocument()
    expect(container.querySelector('.empty-art-group')).not.toBeInTheDocument()
  })
})
