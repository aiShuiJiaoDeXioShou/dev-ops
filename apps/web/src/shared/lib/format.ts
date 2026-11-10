const DEFAULT_TIME_ZONE = 'Asia/Shanghai'

/**
 * 将 ISO 时间或 Date 格式化为中文日期时间；无法解析时返回占位符。
 * @param value 时间值。
 * @param timeZone IANA 时区，默认 Asia/Shanghai。
 * @returns 可展示的日期时间；空值或非法值返回“—”。
 */
export function formatDateTime(value: string | Date | null | undefined, timeZone = DEFAULT_TIME_ZONE): string {
  if (value === null || value === undefined) return '—'
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
}

/**
 * 生成相对于当前时间的简短描述；未来时间也按绝对值展示。
 * @param value 时间值。
 * @param now 当前时间，测试可注入固定值。
 * @returns 刚刚、N 分钟前、N 小时前、N 天前；无法解析返回“—”。
 */
export function formatRelativeTime(value: string | Date | null | undefined, now: Date = new Date()): string {
  if (value === null || value === undefined) return '—'
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  const diffMs = Math.abs(now.getTime() - date.getTime())
  const minutes = Math.floor(diffMs / 60_000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  return `${days} 天前`
}

/**
 * 展示事项稳定编号。
 * @param number 正整数编号。
 * @returns `#编号`；非法编号返回“—”。
 */
export function formatItemNumber(number: number | null | undefined): string {
  if (number === null || number === undefined || !Number.isSafeInteger(number) || number < 1) return '—'
  return `#${number}`
}
