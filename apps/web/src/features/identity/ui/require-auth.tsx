import { Navigate, Outlet, useLocation } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { AppShellSkeleton } from '@/shared/ui/page-skeleton'
import { sessionQueryOptions } from '../api/queries'
import { SessionProvider } from '../model/session'

/**
 * 保护业务路由：未登录跳转登录页，成功后提供团队会话上下文。
 * @returns 受保护子路由或加载/跳转状态。
 */
export function RequireAuth() {
  const location = useLocation()
  const session = useQuery(sessionQueryOptions)
  if (session.isPending) return <AppShellSkeleton />
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
