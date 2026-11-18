import { QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { createMemoryRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createQueryClient } from '@/shared/api/query-client'
import { server, sessionFixture, success, teamFixture } from '@/test/server'
import { localBucketFixture } from '@/test/storage-handlers'
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
  disposers.push(() => {
    router.dispose()
    client.clear()
  })
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return router
}

describe('工作区路由与数据状态', () => {
  afterEach(() => {
    for (const dispose of disposers.splice(0)) dispose()
  })

  it('已登录时进入项目列表', async () => {
    renderApplication('/projects')
    expect(await screen.findByRole('heading', { name: '项目', level: 1 })).toBeVisible()
    expect(await screen.findByText('测试项目')).toBeVisible()
  })

  it('空项目列表与浏览者只读状态', async () => {
    server.use(
      http.get('*/api/v1/me/teams', () =>
        HttpResponse.json({
          success: true,
          code: 'OK',
          message: 'ok',
          requestId: 'trace',
          data: {
            teams: [{ id: 'team-1', name: '测试团队', role: 'viewer', status: 'active' }],
            isPlatformAdmin: false,
          },
        }),
      ),
      http.get('*/api/v1/teams/:teamId/projects', () =>
        HttpResponse.json({
          success: true,
          code: 'OK',
          message: 'ok',
          requestId: 'trace',
          data: { items: [], page: 1, pageSize: 20, total: 0 },
        }),
      ),
    )
    renderApplication('/projects')
    expect(await screen.findByText('还没有项目')).toBeVisible()
    expect(screen.getByRole('button', { name: '创建项目' })).toBeDisabled()
  })

  it('团队加载期间保持布局骨架，不闪现空团队页', async () => {
    let releaseTeams: () => void = () => {
      throw new Error('团队测试响应尚未初始化')
    }
    const pendingTeams = new Promise<void>((resolve) => {
      releaseTeams = resolve
    })
    server.use(
      http.get('*/api/v1/me/teams', async () => {
        await pendingTeams
        return HttpResponse.json({
          success: true,
          code: 'OK',
          message: 'ok',
          requestId: 'trace',
          data: {
            teams: [{ id: 'team-1', name: '测试团队', role: 'admin', status: 'active' }],
            isPlatformAdmin: false,
          },
        })
      }),
    )
    renderApplication('/projects')
    expect((await screen.findAllByRole('status', { name: '页面加载中' })).length).toBeGreaterThan(0)
    expect(screen.queryByText('还没有加入团队')).not.toBeInTheDocument()
    releaseTeams()
    expect(await screen.findByRole('heading', { name: '项目', level: 1 })).toBeVisible()
    expect(screen.queryByRole('status', { name: '页面加载中' })).not.toBeInTheDocument()
  })

  it('未登录访问受保护页面时跳转登录页', async () => {
    server.use(http.get('*/api/v1/auth/get-session', () => HttpResponse.json(null)))
    renderApplication('/projects')
    expect(await screen.findByRole('heading', { name: '登录研发工作台', level: 1 })).toBeVisible()
  })

  it('认证服务返回 502 时保留当前地址，重试后继续进入项目页', async () => {
    server.use(http.get('*/api/v1/auth/get-session', () => new HttpResponse('Bad Gateway', { status: 502 })))
    const router = renderApplication('/projects')
    expect(await screen.findByRole('heading', { name: '暂时无法连接服务', level: 1 })).toBeVisible()
    expect(router.state.location.pathname).toBe('/projects')
    server.use(http.get('*/api/v1/auth/get-session', () => HttpResponse.json(sessionFixture)))
    await userEvent.click(screen.getByRole('button', { name: '重新加载' }))
    expect(await screen.findByRole('heading', { name: '项目', level: 1 })).toBeVisible()
  })

  it.each(['/platform', '/settings/storage-buckets'])('团队管理员直接访问 %s 时看不到平台管理', async (path) => {
    const listBuckets = vi.fn(() => success({ buckets: [localBucketFixture] }))
    server.use(
      http.get('*/api/v1/me/teams', () =>
        success({ teams: [{ ...teamFixture, role: 'admin' }], isPlatformAdmin: false }),
      ),
      http.get('*/api/v1/platform/storage-buckets', listBuckets),
    )
    const router = renderApplication(path)

    expect(await screen.findByText('页面不存在')).toBeVisible()
    expect(screen.queryByRole('link', { name: '平台管理' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '储存桶' })).not.toBeInTheDocument()
    expect(document.title).not.toContain('平台管理')
    expect(router.state.location.pathname).toBe(path)
    expect(listBuckets).not.toHaveBeenCalled()
  })

  it('root 无需团队角色即可通过平台管理入口访问储存桶，旧链接跳转到新地址', async () => {
    server.use(
      http.get('*/api/v1/me/teams', () => success({ teams: [], isPlatformAdmin: true })),
      http.get('*/api/v1/platform/storage-buckets', () => success({ buckets: [localBucketFixture] })),
    )
    const router = renderApplication('/settings/team')

    await userEvent.click(await screen.findByRole('link', { name: '平台管理' }))
    expect(await screen.findByRole('heading', { name: '平台管理', level: 1 })).toBeVisible()
    expect(screen.getByRole('heading', { name: '储存桶', level: 2 })).toBeVisible()
    expect(await screen.findByRole('row', { name: /内置本地桶/ })).toBeVisible()
    expect(screen.queryByRole('link', { name: '储存桶' })).not.toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/platform')

    await act(() => router.navigate('/settings/storage-buckets'))
    await waitFor(() => expect(router.state.location.pathname).toBe('/platform'))
    expect(await screen.findByRole('button', { name: '新建储存桶' })).toBeVisible()
  })

  it.each(['/settings/team?tab=models', '/capabilities/connections'])(
    '模型配置地址 %s 打开团队管理的模型页签',
    async (path) => {
      server.use(http.get('*/api/v1/teams/:teamId/bot-model-connections', () => success([])))
      const router = renderApplication(path)

      expect(await screen.findByRole('heading', { name: '团队管理', level: 1 })).toBeVisible()
      expect(await screen.findByText('还没有模型连接')).toBeVisible()
      expect(screen.getByRole('tab', { name: '模型配置' })).toHaveAttribute('aria-selected', 'true')
      expect(screen.getByRole('button', { name: '添加模型连接' })).toBeVisible()
      expect(router.state.location.pathname).toBe('/settings/team')
      expect(router.state.location.search).toBe('?tab=models')
      expect(document.title).toBe('团队管理 · DevOps')
    },
  )

  it.each(['developer', 'viewer'])('模型配置对 %s 保留只读内容', async (role) => {
    server.use(
      http.get('*/api/v1/me/teams', () => success({ teams: [{ ...teamFixture, role }], isPlatformAdmin: false })),
      http.get('*/api/v1/teams/:teamId/bot-model-connections', () => success([])),
    )
    renderApplication('/settings/team?tab=models')

    expect(await screen.findByText('可用模型连接由团队管理员配置。')).toBeVisible()
    expect(screen.queryByRole('button', { name: '添加模型连接' })).not.toBeInTheDocument()
  })

  it('导航到系统状态复用缓存，支持返回与直接访问深链接', async () => {
    let requests = 0
    server.use(
      http.get('http://localhost/api/v1/ready', () => {
        requests += 1
        return HttpResponse.json({
          success: true,
          code: 'OK',
          message: 'ok',
          requestId: 'test-request',
          data: { status: 'ok', database: 'ok' },
        })
      }),
    )
    const router = renderApplication('/projects')
    await screen.findByRole('heading', { name: '项目', level: 1 })
    await act(() => router.navigate('/system/status'))
    expect(await screen.findByRole('heading', { name: '系统状态', level: 1 })).toBeVisible()
    expect(await screen.findByText('已联通：前端 → API 代理 → 后端 → PostgreSQL')).toBeVisible()
    expect(router.state.location.pathname).toBe('/system/status')
    expect(requests).toBe(1)
    await act(() => router.navigate(-1))
    expect(await screen.findByRole('heading', { name: '项目', level: 1 })).toBeVisible()
    expect(requests).toBe(1)
  })

  it('系统状态深链接可以直接渲染', async () => {
    renderApplication('/system/status')
    expect(await screen.findByRole('heading', { name: '系统状态', level: 1 })).toBeVisible()
    expect(await screen.findByText('请求标识：test-request')).toBeVisible()
  })

  it('数据库失败有明确提示，恢复后能手动重试', async () => {
    server.use(
      http.get('http://localhost/api/v1/ready', () =>
        HttpResponse.json(
          { code: 'DATABASE_UNAVAILABLE' },
          { status: 503, headers: { 'x-request-id': 'database-failure' } },
        ),
      ),
    )
    renderApplication('/system/status')
    expect(await screen.findByRole('alert')).toHaveTextContent('数据库尚未就绪')
    expect(screen.getByText('请求标识：database-failure')).toBeVisible()
    server.use(
      http.get('http://localhost/api/v1/ready', () =>
        HttpResponse.json({
          success: true,
          code: 'OK',
          message: 'ok',
          requestId: 'test-request',
          data: { status: 'ok', database: 'ok' },
        }),
      ),
    )
    await userEvent.click(screen.getByRole('button', { name: '重新检查' }))
    expect(await screen.findByText('已联通：前端 → API 代理 → 后端 → PostgreSQL')).toBeVisible()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('未知地址显示 404 并能回到工作台', async () => {
    renderApplication('/unknown-page')
    expect(await screen.findByRole('heading', { name: '页面不存在' })).toBeVisible()
    await userEvent.click(screen.getByRole('link', { name: '返回项目列表' }))
    expect(await screen.findByRole('heading', { name: '项目', level: 1 })).toBeVisible()
  })

  it('退出登录先弹确认框，取消不会退出', async () => {
    server.use(http.post('*/api/v1/auth/sign-out', () => HttpResponse.json({ success: true })))
    renderApplication('/projects')
    await screen.findByRole('heading', { name: '项目', level: 1 })
    await userEvent.click(screen.getByRole('button', { name: '退出登录' }))
    expect(await screen.findByRole('dialog', { name: '退出登录' })).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: '取消' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByRole('heading', { name: '项目', level: 1 })).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: '退出登录' }))
    await userEvent.click(await screen.findByRole('button', { name: '确认退出' }))
    expect(await screen.findByRole('heading', { name: '登录研发工作台', level: 1 })).toBeVisible()
  })

  it('导航抽屉可通过键盘关闭并恢复触发器焦点', async () => {
    renderApplication('/projects')
    await screen.findByRole('heading', { name: '项目', level: 1 })
    const user = userEvent.setup()
    const trigger = await screen.findByRole('button', { name: '打开导航' })
    await user.click(trigger)
    expect(screen.getByRole('dialog', { name: '工作区导航' })).toBeVisible()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(trigger).toHaveFocus()
  })

  it('从侧栏进入个人资料，可用键盘切换到独立的 API Token 页签', async () => {
    const readTokens = vi.fn()
    server.use(
      http.get('*/api/v1/me/tokens', () => {
        readTokens()
        return HttpResponse.json({
          success: true,
          code: 'OK',
          message: 'ok',
          requestId: 'trace',
          data: { items: [] },
        })
      }),
    )
    const router = renderApplication('/projects')
    const user = userEvent.setup()
    const avatarLink = await screen.findByRole('link', { name: '打开测试用户的个人页面' })
    await user.click(avatarLink)
    expect(await screen.findByRole('heading', { name: '个人页面', level: 1 })).toBeVisible()
    expect(screen.getByRole('button', { name: '编辑资料' })).toBeVisible()
    expect(screen.getByRole('button', { name: '修改密码' })).toBeVisible()
    expect(readTokens).not.toHaveBeenCalled()
    const profile = screen.getByRole('tab', { name: '个人资料' })
    await user.click(profile)
    await user.keyboard('{ArrowRight}')
    expect(await screen.findByText('还没有 API Token')).toBeVisible()
    expect(router.state.location.search).toBe('?tab=tokens')
    expect(screen.queryByRole('button', { name: '修改密码' })).not.toBeInTheDocument()
    await act(() => router.navigate(-1))
    expect(screen.getByRole('tab', { name: '个人资料' })).toHaveAttribute('aria-selected', 'true')
  })

  it('页面渲染异常进入路由边界，不显示内部异常文本', async () => {
    // 此用例主动触发 React 错误边界，预期的控制台输出由测试接管。
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const routes = createAppRoutes()
    const protectedRoute = routes.find((route) => route.children?.some((child) => child.path === '/'))
    const root = protectedRoute?.children?.find((child) => child.path === '/')
    if (!root?.children) throw new Error('缺少根路由配置')
    root.children.unshift({
      path: 'broken-page',
      Component: () => {
        throw new Error('内部数据库凭据不得展示')
      },
    })
    renderApplication('/broken-page', routes)
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('页面暂时无法加载'))
    expect(screen.queryByText('内部数据库凭据不得展示')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: '返回项目列表' })).toBeVisible()
    expect(screen.getByRole('button', { name: '重新加载' })).toBeVisible()
  })
})
