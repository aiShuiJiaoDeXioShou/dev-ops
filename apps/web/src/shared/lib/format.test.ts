import { describe, expect, it } from 'vitest'
import { formatDateTime, formatItemNumber, formatRelativeTime } from './format'

describe('format', () => {
  it('按指定时区格式化时间，空值与非法值返回占位符', () => {
    expect(formatDateTime('2026-11-10T00:00:00.000Z', 'Asia/Shanghai')).toBe('2026/11/10 08:00')
    expect(formatDateTime(undefined)).toBe('—')
    expect(formatDateTime('not-a-date')).toBe('—')
  })

  it('相对时间按注入的当前时间计算', () => {
    const now = new Date('2026-11-10T12:00:00.000Z')
    expect(formatRelativeTime('2026-11-10T11:59:30.000Z', now)).toBe('刚刚')
    expect(formatRelativeTime('2026-11-10T11:30:00.000Z', now)).toBe('30 分钟前')
    expect(formatRelativeTime('2026-11-10T09:00:00.000Z', now)).toBe('3 小时前')
    expect(formatRelativeTime('2026-11-08T12:00:00.000Z', now)).toBe('2 天前')
    expect(formatRelativeTime(null, now)).toBe('—')
  })

  it('格式化事项编号', () => {
    expect(formatItemNumber(1)).toBe('#1')
    expect(formatItemNumber(0)).toBe('—')
    expect(formatItemNumber(undefined)).toBe('—')
  })
})
