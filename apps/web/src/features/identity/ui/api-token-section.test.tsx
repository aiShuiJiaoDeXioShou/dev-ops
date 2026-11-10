import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { createQueryClient } from '@/shared/api/query-client'
import { ToastProvider } from '@/shared/ui/toast'
import { server } from '@/test/server'
import { ApiTokenSection } from './api-token-section'

const tokenFixture = {
  id: 'token-1',
  name: 'local-cli',
  tokenPrefix: 'devops_pat_abcd',
  createdAt: '2026-11-10T00:00:00.000Z',
  expiresAt: '2099-01-01T00:00:00.000Z',
  lastUsedAt: null,
  revokedAt: null,
  status: 'active',
}

function renderSection() {
  render(
    <QueryClientProvider client={createQueryClient()}>
      <ToastProvider>
        <ApiTokenSection />
      </ToastProvider>
    </QueryClientProvider>,
  )
}

describe('ApiTokenSection', () => {
  it('创建 Token 后只在一次性弹窗显示明文', async () => {
    server.use(
      http.get('*/api/v1/me/tokens', () =>
        HttpResponse.json({
          success: true,
          code: 'OK',
          message: 'ok',
          requestId: 'trace',
          data: { items: [] },
        }),
      ),
      http.post('*/api/v1/me/tokens', () =>
        HttpResponse.json({
          success: true,
          code: 'OK',
          message: 'ok',
          requestId: 'trace',
          data: { token: 'devops_pat_secret_once', metadata: tokenFixture },
        }),
      ),
    )
    renderSection()
    await userEvent.click((await screen.findAllByRole('button', { name: '新建 Token' }))[0] as HTMLElement)
    await userEvent.type(screen.getByLabelText('Token 名称'), 'local-cli')
    await userEvent.click(screen.getByRole('button', { name: '创建 Token' }))
    expect(await screen.findByDisplayValue('devops_pat_secret_once')).toBeVisible()
    expect(screen.getByText('请立即复制并妥善保存。关闭后将无法再次查看完整 Token。')).toBeVisible()
  })

  it('撤销前确认，成功后刷新列表', async () => {
    let revoked = false
    server.use(
      http.get('*/api/v1/me/tokens', () =>
        HttpResponse.json({
          success: true,
          code: 'OK',
          message: 'ok',
          requestId: 'trace',
          data: {
            items: [
              revoked ? { ...tokenFixture, status: 'revoked', revokedAt: '2026-11-10T01:00:00.000Z' } : tokenFixture,
            ],
          },
        }),
      ),
      http.post('*/api/v1/me/tokens/:tokenId/revoke', () => {
        revoked = true
        return HttpResponse.json({
          success: true,
          code: 'OK',
          message: 'ok',
          requestId: 'trace',
          data: { ...tokenFixture, status: 'revoked', revokedAt: '2026-11-10T01:00:00.000Z' },
        })
      }),
    )
    renderSection()
    expect(await screen.findByText('local-cli')).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: '撤销' }))
    await userEvent.click(await screen.findByRole('button', { name: '确认撤销' }))
    expect(await screen.findByText('已撤销')).toBeVisible()
  })

  it('接口失败展示错误与重试入口', async () => {
    server.use(
      http.get('*/api/v1/me/tokens', () =>
        HttpResponse.json({
          success: false,
          code: 'INTERNAL_ERROR',
          message: '服务内部错误',
          requestId: 'trace-error',
        }),
      ),
    )
    renderSection()
    expect(await screen.findByText('API Token 加载失败')).toBeVisible()
    expect(screen.getByRole('button', { name: '重新检查' })).toBeVisible()
  })
})
