import { Navigate, type RouteObject } from 'react-router'
import { AppLayout } from '@/app/layouts/app-layout'
import { RequireAuth } from '@/features/identity/public'
import { PageLoading } from '@/shared/ui/page-state'
import { NotFoundPage } from '@/pages/not-found'
import { RouteErrorPage } from './route-error'

/**
 * 创建应用路由；认证页公开，业务页统一经过 RequireAuth 与会话上下文。
 * @returns 可交给浏览器或内存路由器的配置；调用本身不发起 API 请求。
 */
export function createAppRoutes(): RouteObject[] {
  const routes: RouteObject[] = [
    { path: '/login', lazy: () => import('@/pages/auth/login-page'), HydrateFallback: PageLoading },
    {
      path: '/accept-invitation',
      lazy: () => import('@/pages/auth/accept-invitation-page'),
      HydrateFallback: PageLoading,
    },
    { path: '/forgot-password', lazy: () => import('@/pages/auth/forgot-password-page'), HydrateFallback: PageLoading },
    { path: '/reset-password', lazy: () => import('@/pages/auth/reset-password-page'), HydrateFallback: PageLoading },
    {
      element: <RequireAuth />,
      HydrateFallback: PageLoading,
      children: [
        {
          path: '/',
          Component: AppLayout,
          ErrorBoundary: RouteErrorPage,
          HydrateFallback: PageLoading,
          children: [
            { index: true, element: <Navigate to="/projects" replace /> },
            {
              path: 'projects',
              lazy: () => import('@/pages/projects/project-list-page'),
              HydrateFallback: PageLoading,
            },
            {
              path: 'projects/:projectId',
              lazy: () => import('@/pages/project/project-layout'),
              HydrateFallback: PageLoading,
              children: [
                { index: true, element: <Navigate to="requirements" replace /> },
                {
                  path: 'requirements',
                  lazy: () => import('@/pages/project/requirements-page'),
                  HydrateFallback: PageLoading,
                },
                { path: 'bugs', lazy: () => import('@/pages/project/bugs-page'), HydrateFallback: PageLoading },
                {
                  path: 'settings',
                  lazy: () => import('@/pages/project/project-settings-page'),
                  HydrateFallback: PageLoading,
                },
              ],
            },
            {
              path: 'settings/team',
              lazy: () => import('@/pages/settings/team-settings-page'),
              HydrateFallback: PageLoading,
            },
            { path: 'system/status', lazy: () => import('@/pages/system-status'), HydrateFallback: PageLoading },
            { path: '*', Component: NotFoundPage },
          ],
        },
      ],
    },
  ]
  if (import.meta.env.DEV) routes.push({ path: '/prototype/*', lazy: () => import('@/prototype/prototype-app') })
  return routes
}
