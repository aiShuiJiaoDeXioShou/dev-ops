import { describe, expect, it } from 'vitest'
import { skillListQueryOptions } from './queries'

describe('知识资产列表查询', () => {
  it('技能切换搜索词时沿用上一页数据，避免列表卸载导致搜索框丢失焦点', () => {
    expect(skillListQueryOptions('team-1', { search: '前端' }).placeholderData).toBeDefined()
  })
})
