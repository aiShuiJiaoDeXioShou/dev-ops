import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { createQueryClient } from '@/shared/api/query-client'
import { ToastProvider } from '@/shared/ui/toast'
import { BuildReportDialog } from './build-report-dialog'

describe('BuildReportDialog', () => {
  it('构建标识与版本缺失时本地校验阻止提交', async () => {
    render(
      <QueryClientProvider client={createQueryClient()}>
        <ToastProvider>
          <BuildReportDialog projectId="project-1" open onOpenChange={() => undefined} />
        </ToastProvider>
      </QueryClientProvider>,
    )
    await userEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('请填写构建标识')
  })

  it('仅填构建标识与版本时提示缺少产物或说明', async () => {
    render(
      <QueryClientProvider client={createQueryClient()}>
        <ToastProvider>
          <BuildReportDialog projectId="project-1" open onOpenChange={() => undefined} />
        </ToastProvider>
      </QueryClientProvider>,
    )
    await userEvent.type(screen.getByLabelText('构建标识'), 'ci-200')
    await userEvent.type(screen.getByLabelText('版本标识'), '2.0.0')
    await userEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('至少提供一条产物引用或说明')
  })
})
