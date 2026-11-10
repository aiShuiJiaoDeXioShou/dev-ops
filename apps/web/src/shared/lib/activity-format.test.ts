import { describe, expect, it } from 'vitest'
import { formatUtcDate, maskUrl, statusLabel } from './activity-format'

describe('activity-format', () => {
  it('格式化 UTC 日期、脱敏地址与未知状态', () => {
    expect(formatUtcDate('2026-11-10')).toBe('11月10日')
    expect(formatUtcDate('bad')).toBe('bad')
    expect(maskUrl('https://example.test/a?token=secret')).toBe('https://example.test/a')
    expect(maskUrl(null)).toBe('未提供')
    expect(maskUrl('not-url')).toBe('地址不可用')
    expect(statusLabel('succeeded', { succeeded: '成功' })).toBe('成功')
    expect(statusLabel('new_state', {})).toBe('new_state')
  })
})
