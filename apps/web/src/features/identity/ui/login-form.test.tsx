import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { createQueryClient } from '@/shared/api/query-client'
import { server } from '@/test/server'
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
