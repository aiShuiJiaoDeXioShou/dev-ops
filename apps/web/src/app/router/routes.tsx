import { Navigate, type RouteObject } from 'react-router'
import { AppLayout } from '@/app/layouts/app-layout'
import { RequireAuth } from '@/features/identity/public'
import { DelayedPageLoading } from '@/shared/ui/page-state'
import { DelayedAppShellSkeleton, DelayedPageSkeleton } from '@/shared/ui/page-skeleton'
import { NotFoundPage } from '@/pages/not-found'
import { RouteErrorPage } from './route-error'

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
                { index: true, element: <Navigate to="skills" replace /> },
                {
                  path: 'skills',
                  lazy: () => import('@/pages/capabilities/skills-page'),
                  HydrateFallback: DelayedPageSkeleton,
                },
                {
                  path: 'templates',
                  lazy: () => import('@/pages/capabilities/templates-page'),
                  HydrateFallback: DelayedPageSkeleton,
                },
                {
                  path: 'snapshots/:token',
                  lazy: () => import('@/pages/capabilities/template-snapshot-page'),
                  HydrateFallback: DelayedPageSkeleton,
                },
              ],
            },
            {
              path: 'operations/changes',
              lazy: () => import('@/pages/operations/change-plans-page'),
              HydrateFallback: DelayedPageSkeleton,
            },
            {
              path: 'operations/changes/:planId',
              lazy: () => import('@/pages/operations/change-plan-page'),
              HydrateFallback: DelayedPageSkeleton,
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
              path: 'settings/storage-buckets',
              lazy: () => import('@/pages/settings/storage-buckets-page'),
              HydrateFallback: DelayedPageSkeleton,
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
