import { useState } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from 'react-router/dom'
import type { RouterProviderProps } from 'react-router/dom'
import { createQueryClient } from '@/shared/api/query-client'
import { ToastProvider } from '@/shared/ui/toast'

/**
 * 组装应用级查询客户端和路由 Provider。
 * @param props.router 在 React 渲染前创建的路由实例，避免严格模式重复注册浏览器监听。
 * @returns 应用入口；查询客户端在本次挂载期间保持稳定。
 */
export default function App({ router }: { router: RouterProviderProps['router'] }) {
  const [queryClient] = useState(createQueryClient)

  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>
  )
}
