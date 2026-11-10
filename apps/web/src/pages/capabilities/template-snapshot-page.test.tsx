import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { MemoryRouter, Route, Routes } from 'react-router'
import { describe, expect, it } from 'vitest'
import { createQueryClient } from '@/shared/api/query-client'
import { server } from '@/test/server'
import { Component } from './template-snapshot-page'

function ok(data: unknown) {
  return HttpResponse.json({ success: true, code: 'OK', message: 'ok', requestId: 'trace', data })
}

function renderPage(token = 'token-1') {
  render(
    <QueryClientProvider client={createQueryClient()}>
      <MemoryRouter initialEntries={[`/capabilities/snapshots/${token}`]}>
        <Routes>
          <Route path="/capabilities/snapshots/:token" element={<Component />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('TemplateSnapshotPage', () => {
  it('展示分享时的快照正文与版本', async () => {
    server.use(
      http.get('*/api/v1/template-snapshot-links/token-1', () =>
        ok({
          templateId: 'template-1',
          templateName: '默认协作约定',
          tag: '团队',
          contentVersion: 2,
          content: '# AGENTS.md\n- 记录验证',
          createdAt: '2026-11-10T00:00:00.000Z',
        }),
      ),
    )
    renderPage()
    expect(await screen.findByText('默认协作约定 · AGENTS.md')).toBeInTheDocument()
    expect(screen.getByText(/v2 快照/)).toBeInTheDocument()
    expect(screen.getByText(/记录验证/)).toBeInTheDocument()
    expect(screen.getByText('分享时的版本快照。')).toBeInTheDocument()
  })

  it('无效令牌展示错误与重试', async () => {
    server.use(
      http.get('*/api/v1/template-snapshot-links/token-1', () =>
        HttpResponse.json({ success: false, code: 'NOT_FOUND', message: '快照链接不存在或已失效', requestId: 'trace' }),
      ),
    )
    renderPage()
    expect(await screen.findByText('快照不可用')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重新检查' })).toBeInTheDocument()
  })
})
