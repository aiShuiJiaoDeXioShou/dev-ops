import { render, screen } from '@testing-library/react'
import { createMemoryRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { expect, it } from 'vitest'
import { RouteErrorPage } from './route-error'

it.each([
  [401, '登录状态已失效', '重新登录'],
  [403, '没有访问权限', '返回项目列表'],
  [404, '页面不存在', '返回项目列表'],
  [429, '请求过于频繁', '重新加载'],
  [500, '页面暂时无法加载', '重新加载'],
  [502, '暂时无法连接服务', '重新加载'],
  [503, '服务暂时不可用', '重新加载'],
  [504, '服务响应超时', '重新加载'],
])('路由收到 HTTP %s 时展示对应的错误页与恢复入口', async (status, title, action) => {
  const router = createMemoryRouter([
    {
      path: '/',
      loader: () => {
        throw new Response('内部错误正文', { status })
      },
      ErrorBoundary: RouteErrorPage,
      HydrateFallback: () => null,
    },
  ])
  try {
    render(<RouterProvider router={router} />)
    expect(await screen.findByRole('heading', { name: title, level: 1 })).toBeVisible()
    expect(screen.getByRole(action === '重新加载' ? 'button' : 'link', { name: action })).toBeVisible()
    expect(screen.queryByText('内部错误正文')).not.toBeInTheDocument()
  } finally {
    router.dispose()
  }
})
