import { describe, expect, it } from 'vitest'
import { requirementListQueryOptions } from './queries'

describe('requirementListQueryOptions', () => {
  it('切换搜索词时沿用上一页数据，避免列表卸载导致搜索框丢失焦点', () => {
    const options = requirementListQueryOptions('project-1', { search: '登' })
    expect(options.placeholderData).toBeDefined()
  })

  it('筛选条件不同使用独立的缓存键', () => {
    const first = requirementListQueryOptions('project-1', { search: '登录' })
    const second = requirementListQueryOptions('project-1', { search: '登录', status: 'passed' })
    expect(first.queryKey).not.toEqual(second.queryKey)
  })
})
