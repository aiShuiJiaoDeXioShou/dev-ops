import { QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { createMemoryRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createQueryClient } from '@/shared/api/query-client'
import { server } from '@/test/server'
import { createAppRoutes } from './routes'

const disposers: Array<() => void> = []

/**
 * 为每次用例创建独立路由和缓存，避免状态跨测试共享。
 * @param path 初始访问地址。
 * @param routes 路由配置，默认使用真实应用配置。
 * @returns 内存路由实例；资源在用例结束时清理。
 */
function renderApplication(path = '/', routes = createAppRoutes()) {
  const client = createQueryClient()
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  disposers.push(() => { router.dispose(); client.clear() })
  render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>)
  return router
}

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose()
})

describe('工作区路由与数据状态', () => {
  it('请求未完成时显示加载占位，并阻止重复检查', async () => {
    let releaseResponse: () => void = () => { throw new Error('测试响应尚未初始化') }
    const pending = new Promise<void>(resolve => { releaseResponse = resolve })
    server.use(http.get('http://localhost/api/v1/ready', async () => {
      await pending
      return HttpResponse.json({ status: 'ok', database: 'ok' })
    }))
    renderApplication()
    try {
      expect(await screen.findByText('正在检查后端与数据库…')).toBeVisible()
      expect(screen.getByRole('button', { name: '检查中…' })).toBeDisabled()
    } finally {
      releaseResponse()
    }
    expect(await screen.findByText('已联通：前端 → API 代理 → 后端 → PostgreSQL')).toBeVisible()
  })

  it('导航到系统状态复用缓存，支持返回与直接访问深链接', async () => {
    let requests = 0
    server.use(http.get('http://localhost/api/v1/ready', () => {
      requests += 1
      return HttpResponse.json({ status: 'ok', database: 'ok' })
    }))
    const router = renderApplication()
    await screen.findByText('已联通：前端 → API 代理 → 后端 → PostgreSQL')
    await userEvent.click(screen.getByRole('link', { name: '系统状态' }))
    expect(await screen.findByRole('heading', { name: '系统状态', level: 1 })).toBeVisible()
    expect(router.state.location.pathname).toBe('/system/status')
    expect(requests).toBe(1)
    await act(() => router.navigate(-1))
    expect(await screen.findByRole('heading', { name: '工作台', level: 1 })).toBeVisible()
    expect(requests).toBe(1)
  })

  it('系统状态深链接可以直接渲染', async () => {
    renderApplication('/system/status')
    expect(await screen.findByRole('heading', { name: '系统状态', level: 1 })).toBeVisible()
    expect(await screen.findByText('请求标识：test-request')).toBeVisible()
  })

  it('数据库失败有明确提示，恢复后能手动重试', async () => {
    server.use(http.get('http://localhost/api/v1/ready', () => HttpResponse.json(
      { code: 'DATABASE_UNAVAILABLE' },
      { status: 503, headers: { 'x-request-id': 'database-failure' } },
    )))
    renderApplication('/system/status')
    expect(await screen.findByRole('alert')).toHaveTextContent('数据库尚未就绪')
    expect(screen.getByText('请求标识：database-failure')).toBeVisible()
    server.use(http.get('http://localhost/api/v1/ready', () => HttpResponse.json({ status: 'ok', database: 'ok' })))
    await userEvent.click(screen.getByRole('button', { name: '重新检查' }))
    expect(await screen.findByText('已联通：前端 → API 代理 → 后端 → PostgreSQL')).toBeVisible()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('未知地址显示 404 并能回到工作台', async () => {
    renderApplication('/unknown-page')
    expect(await screen.findByRole('heading', { name: '页面不存在' })).toBeVisible()
    await userEvent.click(screen.getByRole('link', { name: '返回工作台' }))
    expect(await screen.findByRole('heading', { name: '工作台', level: 1 })).toBeVisible()
  })

  it('导航抽屉可通过键盘关闭并恢复触发器焦点', async () => {
    renderApplication()
    const user = userEvent.setup()
    const trigger = await screen.findByRole('button', { name: '打开导航' })
    await user.click(trigger)
    expect(screen.getByRole('dialog', { name: '工作区导航' })).toBeVisible()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(trigger).toHaveFocus()
  })

  it('页面渲染异常进入路由边界，不显示内部异常文本', async () => {
    // 此用例主动触发 React 错误边界，预期的控制台输出由测试接管。
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const routes = createAppRoutes()
    const root = routes[0]
    if (!root?.children) throw new Error('缺少根路由配置')
    root.children.unshift({
      path: 'broken-page',
      Component: () => { throw new Error('内部数据库凭据不得展示') },
    })
    renderApplication('/broken-page', routes)
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('页面暂时无法加载'))
    expect(screen.queryByText('内部数据库凭据不得展示')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: '返回工作台' })).toBeVisible()
    expect(screen.getByRole('button', { name: '重新加载' })).toBeVisible()
  })
})
