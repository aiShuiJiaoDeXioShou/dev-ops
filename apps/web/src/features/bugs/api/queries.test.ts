import { describe, expect, it } from 'vitest'
import { bugListQueryOptions } from './queries'

describe('bugListQueryOptions', () => {
  it('切换搜索词时沿用上一页数据，避免列表卸载导致搜索框丢失焦点', () => {
    const options = bugListQueryOptions('project-1', { search: '崩' })
    expect(options.placeholderData).toBeDefined()
  })

  it('筛选条件不同使用独立的缓存键', () => {
    const first = bugListQueryOptions('project-1', { search: '崩溃' })
    const second = bugListQueryOptions('project-1', { search: '崩溃', status: 'resolved' })
    expect(first.queryKey).not.toEqual(second.queryKey)
  })
})
