import { Navigate, Outlet, type RouteObject } from 'react-router'
import { AppLayout } from '@/app/layouts/app-layout'
import { RequireAuth } from '@/features/identity/ui/require-auth'
import { useSession } from '@/features/identity/model/session'
import { DelayedPageLoading } from '@/shared/ui/page-state'
import { DelayedAppShellSkeleton, DelayedPageSkeleton } from '@/shared/ui/page-skeleton'
import { NotFoundPage } from '@/pages/not-found'
import { RouteErrorPage } from './route-error'

function RequirePlatformRoot() {
  const { isPlatformAdmin } = useSession()
  return isPlatformAdmin ? <Outlet /> : <NotFoundPage />
}

/**
 * 创建应用路由；认证页公开，业务页统一经过 RequireAuth 与会话上下文。
 * @returns 可交给浏览器或内存路由器的配置；调用本身不发起 API 请求。
 */
export function createAppRoutes(): RouteObject[] {
  const routes: RouteObject[] = [
    { path: '/login', lazy: () => import('@/pages/auth/login-page'), HydrateFallback: DelayedPageLoading },
    {
      path: '/accept-invitation',
      lazy: () => import('@/pages/auth/accept-invitation-page'),
      HydrateFallback: DelayedPageLoading,
    },
    {
      path: '/forgot-password',
      lazy: () => import('@/pages/auth/forgot-password-page'),
      HydrateFallback: DelayedPageLoading,
    },
    {
      path: '/reset-password',
      lazy: () => import('@/pages/auth/reset-password-page'),
      HydrateFallback: DelayedPageLoading,
    },
    {
      element: <RequireAuth />,
      HydrateFallback: DelayedAppShellSkeleton,
      children: [
        {
          path: '/',
          Component: AppLayout,
          ErrorBoundary: RouteErrorPage,
          HydrateFallback: DelayedPageSkeleton,
          children: [
            { index: true, element: <Navigate to="/projects" replace /> },
            {
              path: 'projects',
              lazy: () => import('@/pages/projects/project-list-page'),
              HydrateFallback: DelayedPageSkeleton,
            },
            {
              path: 'projects/:projectId',
              lazy: () => import('@/pages/project/project-layout'),
              HydrateFallback: DelayedPageSkeleton,
              children: [
                { index: true, element: <Navigate to="requirements" replace /> },
                {
                  path: 'requirements',
                  lazy: () => import('@/pages/project/requirements-page'),
                  HydrateFallback: DelayedPageSkeleton,
                },
                { path: 'bugs', lazy: () => import('@/pages/project/bugs-page'), HydrateFallback: DelayedPageSkeleton },
                { path: 'code', lazy: () => import('@/pages/project/code-page'), HydrateFallback: DelayedPageSkeleton },
                { path: 'prs', lazy: () => import('@/pages/project/prs-page'), HydrateFallback: DelayedPageSkeleton },
                {
                  path: 'pipelines',
                  lazy: () => import('@/pages/project/pipelines-page'),
                  HydrateFallback: DelayedPageSkeleton,
                },
                {
                  path: 'pipelines/:runId',
                  lazy: () => import('@/pages/project/pipeline-run-page'),
                  HydrateFallback: DelayedPageSkeleton,
                },
                {
                  path: 'environment',
                  lazy: () => import('@/pages/project/environment-page'),
                  HydrateFallback: DelayedPageSkeleton,
                },
                {
                  path: 'artifacts',
                  lazy: () => import('@/pages/project/artifacts-page'),
                  HydrateFallback: DelayedPageSkeleton,
                },
              ],
            },
            {
              path: 'capabilities',
              lazy: () => import('@/pages/capabilities/capabilities-layout'),
              HydrateFallback: DelayedPageSkeleton,
              children: [
                { index: true, element: <Navigate to="bots" replace /> },
                {
                  path: 'skills',
                  lazy: () => import('@/pages/capabilities/skills-page'),
                  HydrateFallback: DelayedPageSkeleton,
                },
                {
                  path: 'bots/:botId?',
                  lazy: () => import('@/pages/capabilities/bots-page'),
                  HydrateFallback: DelayedPageSkeleton,
                },
                {
                  path: 'connections',
                  lazy: () => import('@/pages/capabilities/bot-connections-page'),
                  HydrateFallback: DelayedPageSkeleton,
                },
              ],
            },
            {
              path: 'settings/profile',
              lazy: () => import('@/pages/settings/profile-page'),
              HydrateFallback: DelayedPageSkeleton,
            },
            { path: 'vault', lazy: () => import('@/pages/vault-page'), HydrateFallback: DelayedPageSkeleton },
            {
              path: 'settings/team',
              lazy: () => import('@/pages/settings/team-settings-page'),
              HydrateFallback: DelayedPageSkeleton,
            },
            {
              path: 'settings/pipeline-nodes',
              lazy: () => import('@/pages/settings/pipeline-nodes-page'),
              HydrateFallback: DelayedPageSkeleton,
            },
            {
              Component: RequirePlatformRoot,
              children: [
                {
                  path: 'platform',
                  lazy: () => import('@/pages/platform/platform-management-page'),
                  HydrateFallback: DelayedPageSkeleton,
                },
                { path: 'settings/storage-buckets', element: <Navigate to="/platform" replace /> },
              ],
            },
            {
              path: 'system/status',
              lazy: () => import('@/pages/system-status'),
              HydrateFallback: DelayedPageSkeleton,
            },
            { path: '*', Component: NotFoundPage },
          ],
        },
      ],
    },
  ]
  if (import.meta.env.DEV) routes.push({ path: '/prototype/*', lazy: () => import('@/prototype/prototype-app') })
  return routes
}
