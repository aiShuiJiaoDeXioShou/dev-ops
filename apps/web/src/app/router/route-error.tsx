import { RequestError } from '@dev-ops/api-client'
import { isRouteErrorResponse, useRouteError } from 'react-router'
import { PageFailure } from '@/shared/ui/page-failure'

function getErrorStatus(error: unknown): number | undefined {
  if (isRouteErrorResponse(error)) return error.status
  if (!(error instanceof RequestError)) return undefined
  if (error.serverCode === 'UNAUTHENTICATED') return 401
  if (error.serverCode === 'FORBIDDEN') return 403
  if (error.serverCode === 'NOT_FOUND') return 404
  if (error.serverCode === 'RATE_LIMITED') return 429
  return error.status !== null && error.status >= 400 ? error.status : undefined
}

/**
 * 用平台 Bot 错误页呈现路由加载或渲染失败。
 * @returns 根据状态码提供重新加载、重新登录或返回项目列表的界面。
 */
export function RouteErrorPage() {
  const status = getErrorStatus(useRouteError())
  return <PageFailure status={status} onRetry={() => window.location.reload()} fullPage />
}
