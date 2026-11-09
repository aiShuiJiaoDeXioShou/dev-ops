import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { createQueryClient } from '@/shared/api/query-client'
import { server } from '@/test/server'
import { CommentForm } from './comment-form'

describe('CommentForm', () => {
  it('只读角色输入与提交均禁用', () => {
    render(
      <QueryClientProvider client={createQueryClient()}>
        <CommentForm target="requirement" targetId="req-1" disabled />
      </QueryClientProvider>,
    )
    expect(screen.getByLabelText('追加评论')).toBeDisabled()
    expect(screen.getByRole('button', { name: '发表评论' })).toBeDisabled()
  })

  it('提交时携带非空 Idempotency-Key', async () => {
    let idempotencyKey = ''
    server.use(
      http.post('*/api/v1/requirements/req-1/comments', ({ request }) => {
        idempotencyKey = request.headers.get('idempotency-key') ?? ''
        return HttpResponse.json({
          success: true,
          code: 'OK',
          message: 'ok',
          requestId: 'trace',
          data: { id: 'c', authorUserId: 'u', bodyMarkdown: '评论', createdAt: '2026-11-10T00:00:00.000Z' },
        })
      }),
    )
    render(
      <QueryClientProvider client={createQueryClient()}>
        <CommentForm target="requirement" targetId="req-1" />
      </QueryClientProvider>,
    )
    await userEvent.type(screen.getByLabelText('追加评论'), '评论')
    await userEvent.click(screen.getByRole('button', { name: '发表评论' }))
    expect(await screen.findByRole('button', { name: '发表评论' })).toBeInTheDocument()
    expect(idempotencyKey.length).toBeGreaterThan(0)
  })

  it('提交失败时保留输入并显示业务错误', async () => {
    server.use(
      http.post('*/api/v1/requirements/req-1/comments', () =>
        HttpResponse.json({
          success: false,
          code: 'FORBIDDEN',
          message: '无权限',
          requestId: 'trace',
        }),
      ),
    )
    render(
      <QueryClientProvider client={createQueryClient()}>
        <CommentForm target="requirement" targetId="req-1" />
      </QueryClientProvider>,
    )
    await userEvent.type(screen.getByLabelText('追加评论'), '需要补充说明')
    await userEvent.click(screen.getByRole('button', { name: '发表评论' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('当前角色无权执行该操作')
    expect(screen.getByLabelText('追加评论')).toHaveValue('需要补充说明')
  })
})
