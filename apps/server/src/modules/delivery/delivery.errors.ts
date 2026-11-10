/**
 * 判断是否为 PostgreSQL 唯一约束冲突。
 *
 * 并发重复写入时可以回读已存在记录或转换为业务冲突；不依赖进程内判断。
 * @param error 数据库驱动抛出的异常。
 * @returns 错误链中任一环节为 23505 时返回 true。
 */
export function isUniqueConstraintError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  if ('code' in error && error.code === '23505') return true
  return 'cause' in error && isUniqueConstraintError(error.cause)
}
