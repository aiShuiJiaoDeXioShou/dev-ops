import type { RouteObject } from 'react-router'
import { AppLayout } from '@/app/layouts/app-layout'
import { PageLoading } from '@/shared/ui/page-state'
import { NotFoundPage } from '@/pages/not-found'
import { RouteErrorPage } from './route-error'

/**
 * 创建应用路由，业务页面按需加载，共用布局和错误边界。
 * @returns 可交给浏览器或内存路由器的配置；调用本身不发起 API 请求。
 */
export function createAppRoutes(): RouteObject[] {
  const routes: RouteObject[] = [
    {
      path: '/',
      Component: AppLayout,
      ErrorBoundary: RouteErrorPage,
      HydrateFallback: PageLoading,
      children: [
        { index: true, lazy: () => import('@/pages/overview') },
        { path: 'system/status', lazy: () => import('@/pages/system-status') },
        { path: '*', Component: NotFoundPage },
      ],
    },
  ]

  // 交互原型仅用于开发环境预览，不进入生产构建产物；后续组件会提升为正式页面。
  if (import.meta.env.DEV) {
    routes.push({ path: '/prototype/*', lazy: () => import('@/prototype/prototype-app') })
  }

  return routes
}
