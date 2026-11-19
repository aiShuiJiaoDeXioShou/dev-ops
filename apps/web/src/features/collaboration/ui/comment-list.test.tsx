import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { http } from 'msw'
import { expect, it } from 'vitest'
import { createQueryClient } from '@/shared/api/query-client'
import { server, success } from '@/test/server'
import { CommentList } from './comment-list'

it('评论渲染 Markdown 标题、列表和链接，并过滤危险链接', async () => {
  server.use(
    http.get('*/api/v1/requirements/:id/comments', () =>
      success({
        items: [
          {
            id: '11111111-1111-4111-8111-111111111111',
            authorUserId: '22222222-2222-4222-8222-222222222222',
            authorName: '同学',
            authorImage: null,
            createdAt: '2026-11-19T00:00:00Z',
            bodyMarkdown: '## 实现说明\n\n- 已完成\n\n[文档](https://example.test)\n\n[危险](javascript:alert)',
          },
        ],
        page: 1,
        pageSize: 50,
        total: 1,
      }),
    ),
  )
  render(
    <QueryClientProvider client={createQueryClient()}>
      <CommentList target="requirement" targetId="req-1" />
    </QueryClientProvider>,
  )
  expect(await screen.findByRole('heading', { name: '实现说明' })).toBeVisible()
  expect(screen.getByText('已完成').tagName).toBe('LI')
  expect(screen.getByRole('link', { name: '文档' })).toHaveAttribute('href', 'https://example.test')
  expect(screen.getByText('危险')).not.toHaveAttribute('href', 'javascript:alert')
})
