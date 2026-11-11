import { describe, expect, it } from 'vitest'
import { projectActivityQueryOptions } from './queries'

describe('projectActivityQueryOptions', () => {
  it('项目晴雨表在一个会话内缓存，不随重新挂载或窗口聚焦刷新', () => {
    const options = projectActivityQueryOptions('team-1', { source: 'all' })
    expect(options.staleTime).toBe(Number.POSITIVE_INFINITY)
    expect(options.gcTime).toBe(60 * 60_000)
    expect(options.refetchOnWindowFocus).toBe(false)
    expect(options.refetchOnReconnect).toBe(false)
    expect(options.retry).toBe(false)
    expect(options.placeholderData).toBeDefined()
  })

  it('筛选条件不同使用独立的缓存键', () => {
    const all = projectActivityQueryOptions('team-1', { source: 'all' })
    const code = projectActivityQueryOptions('team-1', { source: 'code' })
    expect(all.queryKey).not.toEqual(code.queryKey)
  })
})
