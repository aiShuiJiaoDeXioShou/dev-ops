import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { afterEach, describe, expect, it } from 'vitest'
import { createQueryClient } from '@/shared/api/query-client'
import { createAppRoutes } from '@/app/router/routes'

const disposers: Array<() => void> = []

/**
 * 渲染原型路由并返回内存路由器，供导航与页面内容断言使用。
 * @param path 初始访问地址。
 * @returns 内存路由实例；测试结束后释放。
 */
function renderPrototype(path: string) {
  const client = createQueryClient()
  const router = createMemoryRouter(createAppRoutes(), { initialEntries: [path] })
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

afterEach(() => {
  localStorage.clear()
  for (const dispose of disposers.splice(0)) dispose()
})

describe('交互原型路由', () => {
  it('默认进入项目列表并可打开项目需求', async () => {
    const router = renderPrototype('/prototype')
    expect(await screen.findByRole('heading', { name: '项目', level: 1 })).toBeVisible()
    expect(router.state.location.pathname).toBe('/prototype/projects')

    await userEvent.click(screen.getByRole('button', { name: '研发协作平台' }))
    expect(await screen.findByRole('tab', { name: '需求' })).toBeVisible()
    expect(router.state.location.pathname).toBe('/prototype/project/dev-ops/requirements')
    expect(await screen.findByText('统一接口错误处理')).toBeVisible()

    await userEvent.click(screen.getByText('统一接口错误处理'))
    expect(await screen.findByText('事项详情')).toBeVisible()
    expect(screen.getByRole('button', { name: '提交测试' })).toBeEnabled()
  })

  it('可以切换团队并保持各自项目数据隔离', async () => {
    renderPrototype('/prototype/projects')
    await screen.findByRole('heading', { name: '项目', level: 1 })
    expect(screen.getByText('研发协作平台')).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: '切换到产品团队' }))
    expect(await screen.findByText('客户应用')).toBeVisible()
    expect(screen.queryByText('研发协作平台')).not.toBeInTheDocument()
  })

  it('V0.1 入口与认证原型可以直接打开', async () => {
    renderPrototype('/prototype/v01')
    expect(await screen.findByRole('heading', { name: 'V0.1 原型', level: 1 })).toBeVisible()
    expect(screen.getByRole('link', { name: '打开登录页' })).toBeVisible()
  })

  it.each([
    ['/prototype/auth/login', '登录研发工作台'],
    ['/prototype/auth/accept-invitation', '接受团队邀请'],
    ['/prototype/auth/forgot-password', '找回密码'],
    ['/prototype/auth/reset-password', '设置新密码'],
  ])('认证原型 %s 可以渲染', async (path, title) => {
    renderPrototype(path)
    expect(await screen.findByRole('heading', { name: title, level: 1 })).toBeVisible()
  })

  it('能力页与其余原型模块可以直接打开', async () => {
    renderPrototype('/prototype/capabilities/skills')
    expect(await screen.findByText('技能库')).toBeVisible()
  })

  it.each([
    ['/prototype/collaboration', '研发协作平台协作组', 'text'],
    ['/prototype/operations', '运维', 'heading'],
    ['/prototype/vault', '凭据库', 'heading'],
    ['/prototype/team-admin', '团队管理', 'heading'],
    ['/prototype/capabilities/bots', '智能体目录', 'text'],
    ['/prototype/project/dev-ops/collaboration', '研发协作平台协作组', 'text'],
    ['/prototype/project/dev-ops/code', 'README.md', 'text'],
    ['/prototype/project/dev-ops/pipelines', '运行流水线', 'button'],
    ['/prototype/project/dev-ops/environment', '访问记录', 'button'],
  ] as const)('原型路由 %s 可以渲染', async (path, expectedText, kind) => {
    renderPrototype(path)
    if (kind === 'heading') {
      expect(await screen.findByRole('heading', { name: expectedText, level: 1 })).toBeVisible()
      return
    }
    if (kind === 'button') {
      expect(await screen.findByRole('button', { name: expectedText })).toBeVisible()
      return
    }
    const elements = await screen.findAllByText(expectedText)
    expect(elements.length).toBeGreaterThan(0)
    expect(elements[0]).toBeVisible()
  })
})
