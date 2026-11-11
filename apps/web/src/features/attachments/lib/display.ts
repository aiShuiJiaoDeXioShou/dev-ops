/** 文件大小展示单位；只覆盖附件上限量级可能出现的范围。 */
const FILE_SIZE_UNITS = ['KB', 'MB', 'GB', 'TB'] as const

/**
 * 把字节数格式化为人类可读的大小。
 * @param bytes 文件字节数；负数或非有限值视为异常数据。
 * @returns 形如 `860 B`、`1.5 MB` 的文案；异常值返回占位符 `—`。
 */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes < 1024) return `${bytes} B`
  let value = bytes / 1024
  let unitIndex = 0
  while (value >= 1024 && unitIndex < FILE_SIZE_UNITS.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  const unit = FILE_SIZE_UNITS[unitIndex] ?? 'TB'
  const rounded = value >= 10 ? Math.round(value) : Math.round(value * 10) / 10
  return `${rounded} ${unit}`
}

/**
 * 截断过长文件名并保留扩展名：中间用省略号，便于在窄容器内仍能识别类型。
 * @param fileName 原始文件名。
 * @param maxLength 展示的最大字符数，默认 42，足以覆盖桌面与窄屏附件行。
 * @returns 未超长时原样返回；超长时返回“开头…结尾.扩展名”形式，长度不超过 maxLength。
 */
export function truncateFileName(fileName: string, maxLength = 42): string {
  if (fileName.length <= maxLength) return fileName
  const dotIndex = fileName.lastIndexOf('.')
  const hasExtension = dotIndex > 0 && fileName.length - dotIndex <= 12
  const extension = hasExtension ? fileName.slice(dotIndex) : ''
  const headLength = Math.max(1, Math.ceil((maxLength - extension.length - 1) / 2))
  const tailLength = Math.max(0, maxLength - extension.length - 1 - headLength)
  const head = fileName.slice(0, headLength)
  const tailStart = Math.max(headLength, fileName.length - extension.length - tailLength)
  const tail = fileName.slice(tailStart)
  return `${head}…${tail}`
}
