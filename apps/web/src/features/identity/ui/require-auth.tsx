import type { ReactNode } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { PageFailure } from '@/shared/ui/page-failure'
import { DelayedAppShellSkeleton } from '@/shared/ui/page-skeleton'
import { AuthRequestError } from '../api/auth-client'
import { sessionQueryOptions } from '../api/queries'
import { SessionProvider } from '../model/session'

/**
 * 保护业务路由：未登录跳转登录页，成功后提供团队会话上下文。
 *
 * 登录成功返回后，缓存的会话可能仍是登录前的 null 且正在重新获取；
 * 此时先展示骨架而不是立即重定向，避免把刚登录的用户弹回登录页。
 * 认证服务出错时在当前地址提供重试，只有会话明确失效时才跳转登录。
 * @param props.sessionFallback 应用在等待认证时提供的加载视图，默认显示工作区骨架。
 * @returns 受保护子路由、加载状态、登录跳转或服务错误页。
 */
export function RequireAuth({ sessionFallback = <DelayedAppShellSkeleton /> }: { sessionFallback?: ReactNode }) {
  const location = useLocation()
  const session = useQuery(sessionQueryOptions)
  const isCheckingSession = session.isPending || (session.data === null && session.isFetching)
  if (isCheckingSession) return sessionFallback
  if (!session.data) {
    const status = session.error instanceof AuthRequestError ? session.error.status : undefined
    if (session.isError && status !== 401) {
      return (
        <PageFailure
          status={status && status >= 400 ? status : undefined}
          onRetry={() => void session.refetch()}
          fullPage
        />
      )
    }
    const redirect = `${location.pathname}${location.search}`
    return <Navigate to={`/login?redirect=${encodeURIComponent(redirect)}`} replace />
  }
  return (
    <SessionProvider initialUser={session.data.user}>
      <Outlet />
    </SessionProvider>
  )
}
