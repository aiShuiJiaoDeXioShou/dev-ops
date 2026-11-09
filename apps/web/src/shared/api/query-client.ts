import { QueryClient } from '@tanstack/react-query'
import { RequestError } from '@dev-ops/api-client'

/**
 * 只对暂时性读取失败重试一次，不重试权限、参数或契约错误。
 * @param failureCount 已发生的重试次数。
 * @param error 当前查询错误。
 * @returns 是否允许重试；写操作不使用此策略。
 */
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (failureCount >= 1 || !(error instanceof RequestError)) return false
  return error.code === 'NETWORK_ERROR' || error.code === 'TIMEOUT' || (error.status !== null && error.status >= 500)
}

/**
 * 创建独立查询客户端，供应用或测试持有其生命周期。
 * @returns 缓存读取结果、限制重试且不自动重试写操作的 QueryClient。
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        retry: shouldRetryQuery,
        retryDelay: 500,
      },
      mutations: { retry: false },
    },
  })
}
