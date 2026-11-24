import { useLocation } from 'react-router'
import { RoutePageSkeleton } from '@/pages/page-skeletons'
import { DelayedLoading } from '@/shared/ui/delayed-loading'
import { AppShellSkeleton } from '@/shared/ui/page-skeleton'

/**
 * 在路由初始化或认证期间显示符合当前路由的工作区外壳与专属页面骨架。
 * @returns 延迟展示带主导航与对应路由内容占位的加载视图。
 */
export function WorkspaceShellSkeleton() {
  const { pathname } = useLocation()
  return (
    <DelayedLoading pending>
      <AppShellSkeleton>
        <RoutePageSkeleton pathname={pathname} delay={0} />
      </AppShellSkeleton>
    </DelayedLoading>
  )
}
