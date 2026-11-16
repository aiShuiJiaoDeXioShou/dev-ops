import { describe, expect, it } from 'vitest'
import { projectActivityQueryOptions, projectListQueryOptions } from './queries'

describe('projectListQueryOptions', () => {
  it('切换搜索词时沿用上一页数据，避免列表卸载导致搜索框丢失焦点', () => {
    const options = projectListQueryOptions('team-1', { search: 'dev' })
    expect(options.placeholderData).toBeDefined()
  })
})

describe('projectActivityQueryOptions', () => {
  it('项目晴雨表缓存一分钟，页面打开期间读取后台同步结果', () => {
    const options = projectActivityQueryOptions('team-1', { source: 'all' })
    expect(options.staleTime).toBe(60_000)
    expect(options.refetchInterval).toBe(60_000)
    expect(options.placeholderData).toBeDefined()
  })

  it('筛选条件不同使用独立的缓存键', () => {
    const all = projectActivityQueryOptions('team-1', { source: 'all' })
    const code = projectActivityQueryOptions('team-1', { source: 'code' })
    expect(all.queryKey).not.toEqual(code.queryKey)
  })
})
