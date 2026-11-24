import { Navigate, Outlet, useLocation, type RouteObject } from 'react-router'
import { AppLayout } from '@/app/layouts/app-layout'
import { WorkspaceShellSkeleton } from '@/app/layouts/workspace-loading'
import { RequireAuth } from '@/features/identity/ui/require-auth'
import { useSession } from '@/features/identity/model/session'
import { CollaborationPageSkeleton } from '@/pages/collaboration/conversation-loading'
import {
  ArtifactsPageSkeleton,
  AuthPageSkeleton,
  BotMemoryPageSkeleton,
  BotsPageSkeleton,
  BugsPageSkeleton,
  CapabilitiesLayoutSkeleton,
  CodePageSkeleton,
  EnvironmentPageSkeleton,
  PipelineNodesPageSkeleton,
  PipelineRunPageSkeleton,
  PipelinesPageSkeleton,
  PlatformManagementPageSkeleton,
  ProfilePageSkeleton,
  ProjectLayoutSkeleton,
  ProjectListPageSkeleton,
  PromptTemplatesPageSkeleton,
  PrsPageSkeleton,
  RequirementsPageSkeleton,
  RoutePageSkeleton,
  SkillsPageSkeleton,
  SystemStatusPageSkeleton,
  TeamSettingsPageSkeleton,
  VaultPageSkeleton,
} from '@/pages/page-skeletons'
import { NotFoundPage } from '@/pages/not-found'
import { collaborationRoutePath } from './collaboration-path'
import { RouteErrorPage } from './route-error'

function RequirePlatformRoot() {
  const { isPlatformAdmin } = useSession()
  return isPlatformAdmin ? <Outlet /> : <NotFoundPage />
}

/** 业务根路由懒加载回退：按当前路径匹配对应页面的专属骨架。 */
function CurrentRouteSkeleton() {
  const { pathname } = useLocation()
  return <RoutePageSkeleton pathname={pathname} />
}

/** 项目工作区布局懒加载回退：渲染项目头部与当前子页对应的骨架。 */
function CurrentProjectLayoutSkeleton() {
  const { pathname } = useLocation()
  return <ProjectLayoutSkeleton pathname={pathname} />
}

/** 能力中心布局懒加载回退：渲染能力导航与当前子页对应的骨架。 */
function CurrentCapabilitiesLayoutSkeleton() {
  const { pathname } = useLocation()
  return <CapabilitiesLayoutSkeleton pathname={pathname} />
}

/**
 * 创建应用路由；认证页公开，业务页统一经过 RequireAuth 与会话上下文。
 * @returns 可交给浏览器或内存路由器的配置；调用本身不发起 API 请求。
 */
export function createAppRoutes(): RouteObject[] {
  const routes: RouteObject[] = [
    { path: '/login', lazy: () => import('@/pages/auth/login-page'), HydrateFallback: AuthPageSkeleton },
    {
      path: '/accept-invitation',
      lazy: () => import('@/pages/auth/accept-invitation-page'),
      HydrateFallback: AuthPageSkeleton,
    },
    {
      path: '/forgot-password',
      lazy: () => import('@/pages/auth/forgot-password-page'),
      HydrateFallback: AuthPageSkeleton,
    },
    {
      path: '/reset-password',
      lazy: () => import('@/pages/auth/reset-password-page'),
      HydrateFallback: AuthPageSkeleton,
    },
    {
      element: <RequireAuth sessionFallback={<WorkspaceShellSkeleton />} />,
      HydrateFallback: WorkspaceShellSkeleton,
      children: [
        {
          path: '/',
          Component: AppLayout,
          ErrorBoundary: RouteErrorPage,
          HydrateFallback: CurrentRouteSkeleton,
          children: [
            { index: true, element: <Navigate to="/collaboration" replace /> },
            {
              path: collaborationRoutePath,
              lazy: () => import('@/pages/collaboration/conversations-page'),
              HydrateFallback: CollaborationPageSkeleton,
            },
            {
              path: 'projects',
              lazy: () => import('@/pages/projects/project-list-page'),
              HydrateFallback: ProjectListPageSkeleton,
            },
            {
              path: 'projects/:projectId',
              lazy: () => import('@/pages/project/project-layout'),
              HydrateFallback: CurrentProjectLayoutSkeleton,
              children: [
                { index: true, element: <Navigate to="requirements" replace /> },
                {
                  path: 'requirements',
                  lazy: () => import('@/pages/project/requirements-page'),
                  HydrateFallback: RequirementsPageSkeleton,
                },
                { path: 'bugs', lazy: () => import('@/pages/project/bugs-page'), HydrateFallback: BugsPageSkeleton },
                { path: 'code', lazy: () => import('@/pages/project/code-page'), HydrateFallback: CodePageSkeleton },
                { path: 'prs', lazy: () => import('@/pages/project/prs-page'), HydrateFallback: PrsPageSkeleton },
                {
                  path: 'pipelines',
                  lazy: () => import('@/pages/project/pipelines-page'),
                  HydrateFallback: PipelinesPageSkeleton,
                },
                {
                  path: 'pipelines/:runId',
                  lazy: () => import('@/pages/project/pipeline-run-page'),
                  HydrateFallback: PipelineRunPageSkeleton,
                },
                {
                  path: 'environment',
                  lazy: () => import('@/pages/project/environment-page'),
                  HydrateFallback: EnvironmentPageSkeleton,
                },
                {
                  path: 'artifacts',
                  lazy: () => import('@/pages/project/artifacts-page'),
                  HydrateFallback: ArtifactsPageSkeleton,
                },
              ],
            },
            {
              path: 'capabilities',
              lazy: () => import('@/pages/capabilities/capabilities-layout'),
              HydrateFallback: CurrentCapabilitiesLayoutSkeleton,
              children: [
                { index: true, element: <Navigate to="bots" replace /> },
                {
                  path: 'skills',
                  lazy: () => import('@/pages/capabilities/skills-page'),
                  HydrateFallback: SkillsPageSkeleton,
                },
                {
                  path: 'bots/:botId?',
                  lazy: () => import('@/pages/capabilities/bots-page'),
                  HydrateFallback: BotsPageSkeleton,
                },
                {
                  path: 'memory',
                  lazy: () => import('@/pages/capabilities/bot-memory-page'),
                  HydrateFallback: BotMemoryPageSkeleton,
                },
                {
                  path: 'usage',
                  element: <Navigate to="/settings/team?tab=agents&agentTab=usage" replace />,
                },
                {
                  path: 'prompt-templates',
                  lazy: () => import('@/pages/capabilities/bot-prompt-templates-page'),
                  HydrateFallback: PromptTemplatesPageSkeleton,
                },
                {
                  path: 'team-context',
                  element: <Navigate to="/settings/team?tab=agents&agentTab=context" replace />,
                },
                {
                  path: 'connections',
                  element: <Navigate to="/settings/team?tab=models" replace />,
                },
              ],
            },
            {
              path: 'settings/profile',
              lazy: () => import('@/pages/settings/profile-page'),
              HydrateFallback: ProfilePageSkeleton,
            },
            { path: 'vault', lazy: () => import('@/pages/vault-page'), HydrateFallback: VaultPageSkeleton },
            {
              path: 'settings/team',
              lazy: () => import('@/pages/settings/team-settings-page'),
              HydrateFallback: TeamSettingsPageSkeleton,
            },
            {
              path: 'settings/pipeline-nodes',
              lazy: () => import('@/pages/settings/pipeline-nodes-page'),
              HydrateFallback: PipelineNodesPageSkeleton,
            },
            {
              Component: RequirePlatformRoot,
              children: [
                {
                  path: 'platform',
                  lazy: () => import('@/pages/platform/platform-management-page'),
                  HydrateFallback: PlatformManagementPageSkeleton,
                },
                { path: 'settings/storage-buckets', element: <Navigate to="/platform" replace /> },
              ],
            },
            {
              path: 'system/status',
              lazy: () => import('@/pages/system-status'),
              HydrateFallback: SystemStatusPageSkeleton,
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
