/** 将 UTC 日期字符串格式化为短标签；不合法时返回原值。 */
export function formatUtcDate(value: string): string {
  const date = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(date.getTime())) return value
  return `${date.getUTCMonth() + 1}月${date.getUTCDate()}日`
}

/** 对展示用地址做安全截断，不解析凭据；空值返回“未提供”。 */
export function maskUrl(value: string | null | undefined): string {
  if (!value) return '未提供'
  try {
    const url = new URL(value)
    return `${url.origin}${url.pathname.length > 1 ? url.pathname : ''}`
  } catch {
    return '地址不可用'
  }
}

/** 业务状态标签；未知状态原样返回，避免伪造。 */
export function statusLabel(value: string, labels: Record<string, string>): string {
  return labels[value] ?? value
}
