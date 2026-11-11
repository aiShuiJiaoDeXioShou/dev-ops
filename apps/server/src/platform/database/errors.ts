/**
 * 判断错误链中是否包含 PostgreSQL 唯一约束冲突（SQLSTATE 23505）。
 * Drizzle 会把驱动层错误包在 `DrizzleQueryError.cause` 中，只检查顶层 `code`
 * 会把可预期的业务冲突误判为未知异常并返回 500，因此需要递归解包 cause。
 * @param error 捕获到的未知错误。
 * @returns 错误链中存在唯一约束冲突时为 true。
 */
export function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  if ('code' in error && error.code === '23505') return true
  return 'cause' in error && isUniqueViolation(error.cause)
}
