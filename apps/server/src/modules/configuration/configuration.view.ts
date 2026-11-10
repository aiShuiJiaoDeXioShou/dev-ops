/** 分页响应统一结构；列表查询必须限定返回量并使用稳定排序。 */
export interface PageResult<T> {
  items: T[]
  page: number
  pageSize: number
  total: number
}

/** 组装分页响应。 */
export function toPageResult<T>(items: T[], page: number, pageSize: number, total: number): PageResult<T> {
  return { items, page, pageSize, total }
}

/**
 * 时间点转 ISO 8601 字符串。
 * @param value 数据库时间点或 null。
 * @returns 带时区的 ISO 字符串；null 保持 null，避免把“长期有效”序列化成特殊日期。
 */
export function toIso(value: Date | null): string | null {
  return value === null ? null : value.toISOString()
}
