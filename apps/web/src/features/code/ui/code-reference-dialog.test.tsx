import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { createQueryClient } from '@/shared/api/query-client'
import { server } from '@/test/server'
import { CodeReferenceDialog } from './code-reference-dialog'

function ok(data: unknown) {
  return HttpResponse.json({ success: true, code: 'OK', message: 'ok', requestId: 'trace', data })
}

describe('CodeReferenceDialog', () => {
  it('来源核对失败时显示业务错误且不保存', async () => {
    server.use(
      http.get('*/api/v1/projects/project-1/repositories', () =>
        ok([
          {
            id: 'repo-1',
            connectionId: 'conn-1',
            providerKey: 'github',
            namespace: 'ops',
            name: 'app',
            webUrl: 'https://example.test/ops/app',
            defaultBranch: 'main',
            status: 'available',
          },
        ]),
      ),
      http.post('*/api/v1/projects/project-1/code-references', () =>
        HttpResponse.json({
          success: false,
          code: 'PRECONDITION_FAILED',
          message: '核对失败',
          requestId: 'trace',
          data: { errorCode: 'auth_failed' },
        }),
      ),
    )
    render(
      <QueryClientProvider client={createQueryClient()}>
        <CodeReferenceDialog
          projectId="project-1"
          targetType="requirement"
          targetId="req-1"
          open
          onOpenChange={() => undefined}
        />
      </QueryClientProvider>,
    )
    await userEvent.type(await screen.findByLabelText('远端编号'), '12')
    await userEvent.selectOptions(screen.getByLabelText('仓库'), 'repo-1')
    await userEvent.click(screen.getByRole('button', { name: '核对并添加' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('当前状态不允许该操作')
  })
})
