import { useLocation } from 'react-router'
import { isCollaborationPath } from '@/app/router/collaboration-path'
import { CollaborationPageSkeleton } from '@/pages/collaboration/conversation-loading'
import { DelayedLoading } from '@/shared/ui/delayed-loading'
import { AppShellSkeleton, DelayedAppShellSkeleton } from '@/shared/ui/page-skeleton'

/**
 * 在路由初始化或认证期间显示符合当前路由的工作区骨架。
 * @returns 延迟展示带主导航占位的加载视图。
 */
export function WorkspaceShellSkeleton() {
  const { pathname } = useLocation()
  if (!isCollaborationPath(pathname)) return <DelayedAppShellSkeleton />
  return (
    <DelayedLoading pending>
      <AppShellSkeleton>
        <CollaborationPageSkeleton delay={0} />
      </AppShellSkeleton>
    </DelayedLoading>
  )
}
