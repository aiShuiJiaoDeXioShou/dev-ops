import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { MemoryRouter, Route, Routes } from 'react-router'
import { describe, expect, it } from 'vitest'
import { createQueryClient } from '@/shared/api/query-client'
import { server, sessionFixture } from '@/test/server'
import { sessionQueryOptions } from '../api/queries'
import { LoginForm } from './login-form'

describe('LoginForm', () => {
  it('登录失败显示安全错误且不跳转', async () => {
    server.use(
      http.post('*/api/v1/auth/sign-in/email', () => HttpResponse.json({ message: 'invalid' }, { status: 401 })),
    )
    render(
      <QueryClientProvider client={createQueryClient()}>
        <MemoryRouter>
          <LoginForm />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    await userEvent.type(screen.getByLabelText('邮箱'), 'user@example.test')
    await userEvent.type(screen.getByLabelText('密码'), 'wrong-password')
    await userEvent.click(screen.getByRole('button', { name: '登录' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('邮箱或密码不正确')
  })

  it('登录成功后先等待会话写回缓存再跳转', async () => {
    let signedIn = false
    server.use(
      http.get('*/api/v1/auth/get-session', () => HttpResponse.json(signedIn ? sessionFixture : null)),
      http.post('*/api/v1/auth/sign-in/email', () => {
        signedIn = true
        return HttpResponse.json({ redirect: false, token: 'session-token', user: sessionFixture.user })
      }),
    )
    const client = createQueryClient()
    // 模拟登录前受保护路由已把未登录会话写入缓存，登录后必须刷新这份缓存。
    await client.prefetchQuery(sessionQueryOptions)
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/login?redirect=/system/status']}>
          <Routes>
            <Route path="/login" element={<LoginForm />} />
            <Route path="/system/status" element={<p>目标页面</p>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )
    await userEvent.type(screen.getByLabelText('邮箱'), 'user@example.test')
    await userEvent.type(screen.getByLabelText('密码'), 'password-123')
    await userEvent.click(screen.getByRole('button', { name: '登录' }))
    expect(await screen.findByText('目标页面')).toBeInTheDocument()
    expect(client.getQueryData(sessionQueryOptions.queryKey)).toEqual(sessionFixture)
  })

  it('未填写邮箱密码时本地校验阻止请求', async () => {
    render(
      <QueryClientProvider client={createQueryClient()}>
        <MemoryRouter>
          <LoginForm />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    await userEvent.click(screen.getByRole('button', { name: '登录' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('请填写邮箱和密码')
  })
})
