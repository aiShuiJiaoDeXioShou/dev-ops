import { Navigate, Outlet, useLocation } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { DelayedAppShellSkeleton } from '@/shared/ui/page-skeleton'
import { sessionQueryOptions } from '../api/queries'
import { SessionProvider } from '../model/session'

/**
 * 保护业务路由：未登录跳转登录页，成功后提供团队会话上下文。
 *
 * 登录成功返回后，缓存的会话可能仍是登录前的 null 且正在重新获取；
 * 此时先展示骨架而不是立即重定向，避免把刚登录的用户弹回登录页。
 * @returns 受保护子路由或加载/跳转状态。
 */
export function RequireAuth() {
  const location = useLocation()
  const session = useQuery(sessionQueryOptions)
  const isCheckingSession = session.isPending || (session.data === null && session.isFetching)
  if (isCheckingSession) return <DelayedAppShellSkeleton />
  if (!session.data) {
    const redirect = `${location.pathname}${location.search}`
    return <Navigate to={`/login?redirect=${encodeURIComponent(redirect)}`} replace />
  }
  return (
    <SessionProvider initialUser={session.data.user}>
      <Outlet />
    </SessionProvider>
  )
}
