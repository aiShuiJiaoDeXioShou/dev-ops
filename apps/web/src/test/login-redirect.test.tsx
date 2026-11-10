import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { createMemoryRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { describe, expect, it } from 'vitest'
import { createAppRoutes } from '@/app/router/routes'
import { createQueryClient } from '@/shared/api/query-client'
import { server, sessionFixture } from '@/test/server'

/**
 * 模拟“未登录 → 登录成功 → 会话可读”的真实认证状态流转。
 * 登录前 get-session 返回 null，登录后返回会话，用于复现登录后会话缓存为空的场景。
 */
function mockSignInFlow() {
  let signedIn = false
  server.use(
    http.get('*/api/v1/auth/get-session', () => HttpResponse.json(signedIn ? sessionFixture : null)),
    http.post('*/api/v1/auth/sign-in/email', () => {
      signedIn = true
      return HttpResponse.json({ redirect: false, token: 'session-token', user: sessionFixture.user })
    }),
  )
}

/**
 * 渲染完整应用路由。
 * @param path 初始访问地址。
 * @returns 内存路由实例，用于断言最终地址。
 */
function renderApplication(path: string) {
  const client = createQueryClient()
  const router = createMemoryRouter(createAppRoutes(), { initialEntries: [path] })
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return router
}

/**
 * 在登录页填写账号密码并提交。
 * @returns 登录提交完成后的 Promise。
 */
async function submitLoginForm() {
  await userEvent.type(await screen.findByLabelText('邮箱'), 'user@example.test')
  await userEvent.type(screen.getByLabelText('密码'), 'password-123')
  await userEvent.click(screen.getByRole('button', { name: '登录' }))
}

describe('登录后的会话重定向', () => {
  it('从根路径登录后进入项目列表，不被登录前的空会话缓存重定向', async () => {
    mockSignInFlow()
    const router = renderApplication('/')
    expect(await screen.findByRole('heading', { name: '登录研发工作台', level: 1 })).toBeVisible()
    await submitLoginForm()
    expect(await screen.findByRole('heading', { name: '项目', level: 1 })).toBeVisible()
    expect(router.state.location.pathname).toBe('/projects')
  })

  it('从受保护深链登录后回到原目标页面', async () => {
    mockSignInFlow()
    const router = renderApplication('/system/status')
    expect(await screen.findByRole('heading', { name: '登录研发工作台', level: 1 })).toBeVisible()
    await submitLoginForm()
    expect(await screen.findByRole('heading', { name: '系统状态', level: 1 })).toBeVisible()
    expect(router.state.location.pathname).toBe('/system/status')
  })
})
