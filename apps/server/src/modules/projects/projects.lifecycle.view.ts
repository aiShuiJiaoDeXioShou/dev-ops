/** 文件清理状态，none 表示本次删除还未发起清理。 */
export type CleanupStatus = 'none' | 'queued' | 'running' | 'succeeded' | 'failed'

/**
 * 将数据库任务状态转换为回收站展示状态。
 * @param status 数据库状态，未有任务时为 null。
 * @returns 对外展示状态。
 * @throws 数据库状态不合法时抛出 Error。
 */
export function cleanupStatusOf(status: string | null): CleanupStatus {
  if (status === null) return 'none'
  if (status === 'queued' || status === 'running' || status === 'succeeded' || status === 'failed') return status
  throw new Error('数据库项目文件清理状态不合法')
}
