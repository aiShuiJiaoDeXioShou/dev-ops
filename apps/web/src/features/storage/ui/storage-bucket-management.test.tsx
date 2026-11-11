import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { createQueryClient } from '@/shared/api/query-client'
import { ToastProvider } from '@/shared/ui/toast'
import { server, success } from '@/test/server'
import {
  localBucketFixture,
  s3BucketFixture,
  storageBucketListHandler,
  storageBucketTestHandler,
  untestedBucketFixture,
} from '@/test/storage-handlers'
import type { StorageBucket } from '../model/types'
import { StorageBucketManagement } from './storage-bucket-management'

// jsdom 未实现 ResizeObserver；Radix Checkbox 的指示器尺寸监听在测试环境需要桩实现。
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = ResizeObserverStub
}

/** 渲染管理面板；管理面板不依赖会话上下文，权限门禁由页面层测试覆盖。 */
function renderPanel() {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <ToastProvider>
        <StorageBucketManagement />
      </ToastProvider>
    </QueryClientProvider>,
  )
}

/** 业务失败信封：平台统一 HTTP 200 + success=false。 */
function businessFailure(code: string, message: string, data?: unknown) {
  return HttpResponse.json({
    success: false,
    code,
    message,
    requestId: 'trace-storage',
    ...(data === undefined ? {} : { data }),
  })
}

describe('StorageBucketManagement', () => {
  it('展示桶名、类型、默认标记、状态与最近探测结论', async () => {
    server.use(storageBucketListHandler([localBucketFixture, s3BucketFixture]))
    renderPanel()
    expect(await screen.findByText('内置本地桶')).toBeInTheDocument()
    expect(screen.getByText('生产附件桶')).toBeInTheDocument()
    const defaultRow = screen.getByRole('row', { name: /内置本地桶/ })
    expect(within(defaultRow).getByText('默认')).toBeInTheDocument()
    expect(within(defaultRow).getByText('本地储存')).toBeInTheDocument()
    expect(within(defaultRow).getByText('启用')).toBeInTheDocument()
    expect(within(defaultRow).getByText('可读写')).toBeInTheDocument()
    const s3Row = screen.getByRole('row', { name: /生产附件桶/ })
    expect(within(s3Row).getByText('S3 兼容')).toBeInTheDocument()
    expect(within(s3Row).getByText('可读写')).toBeInTheDocument()
    // 内置桶没有删除入口。
    expect(within(defaultRow).queryByRole('button', { name: '删除' })).not.toBeInTheDocument()
  })

  it('区分四类连接探测结论', async () => {
    const buckets: StorageBucket[] = [
      localBucketFixture,
      {
        ...s3BucketFixture,
        id: 'probe-1',
        name: '只读桶',
        lastProbe: { result: 'read_only', message: '可读不可写', at: null },
      },
      {
        ...s3BucketFixture,
        id: 'probe-2',
        name: '断连桶',
        lastProbe: { result: 'unreachable', message: '连接超时', at: null },
      },
      {
        ...s3BucketFixture,
        id: 'probe-3',
        name: '错凭据桶',
        lastProbe: { result: 'auth_failed', message: 'Access Key 被拒绝', at: null },
      },
    ]
    server.use(storageBucketListHandler(buckets))
    renderPanel()
    expect(await screen.findByText('只读不可写')).toBeInTheDocument()
    expect(screen.getByText('连接超时')).toBeInTheDocument()
    expect(screen.getByText('凭据无效')).toBeInTheDocument()
  })

  it('未通过可读写测试的桶禁用设为默认并说明原因', async () => {
    server.use(storageBucketListHandler([localBucketFixture, untestedBucketFixture]))
    renderPanel()
    const row = await screen.findByRole('row', { name: /待测试桶/ })
    expect(within(row).getByRole('button', { name: '设为默认' })).toBeDisabled()
    expect(within(row).getByText('请先完成连接测试并确认可读写')).toBeInTheDocument()
  })

  it('测试连接后展示结论并刷新列表', async () => {
    server.use(
      storageBucketListHandler([localBucketFixture, untestedBucketFixture]),
      storageBucketTestHandler('read_only', '写入探针被拒绝'),
    )
    renderPanel()
    const row = await screen.findByRole('row', { name: /待测试桶/ })
    await userEvent.click(within(row).getByRole('button', { name: '测试连接' }))
    expect(await screen.findByText(/连接测试完成，只读不可写：写入探针被拒绝/)).toBeInTheDocument()
  })

  it('设为默认前二次确认，确认后提交版本并提示成功', async () => {
    const requested: unknown[] = []
    server.use(
      storageBucketListHandler([localBucketFixture, s3BucketFixture]),
      http.post('*/api/v1/platform/storage-buckets/:bucketId/set-default', async ({ request }) => {
        requested.push(await request.json())
        return success({ ...s3BucketFixture, isDefault: true, version: 3 })
      }),
    )
    renderPanel()
    const row = await screen.findByRole('row', { name: /生产附件桶/ })
    await userEvent.click(within(row).getByRole('button', { name: '设为默认' }))
    const confirm = await screen.findByRole('alertdialog')
    expect(confirm).toHaveTextContent('设为默认储存桶')
    await userEvent.click(within(confirm).getByRole('button', { name: '设为默认' }))
    expect(await screen.findByText('默认储存桶已切换。')).toBeInTheDocument()
    expect(requested).toEqual([{ version: 2 }])
  })

  it('删除被附件引用的桶时就地提示引用原因并保留弹窗', async () => {
    server.use(
      storageBucketListHandler([localBucketFixture, s3BucketFixture]),
      http.post('*/api/v1/platform/storage-buckets/:bucketId/remove', () =>
        businessFailure('STORAGE_BUCKET_IN_USE', '该储存桶仍被 2 个附件引用，不能删除', {
          attachmentCount: 2,
        }),
      ),
    )
    renderPanel()
    const row = await screen.findByRole('row', { name: /生产附件桶/ })
    await userEvent.click(within(row).getByRole('button', { name: '删除' }))
    const confirm = await screen.findByRole('alertdialog')
    expect(confirm).toHaveTextContent('删除后不可恢复')
    await userEvent.click(within(confirm).getByRole('button', { name: '删除储存桶' }))
    expect(await within(confirm).findByText(/该储存桶仍被 2 个附件引用/)).toBeInTheDocument()
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
  })

  it('创建表单校验必填并聚焦首个错误字段，密钥使用密码输入', async () => {
    server.use(storageBucketListHandler([localBucketFixture]))
    renderPanel()
    await userEvent.click(await screen.findByRole('button', { name: '新建储存桶' }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: '保存' }))
    const alerts = await within(dialog).findAllByRole('alert')
    expect(alerts[0]).toHaveTextContent('请填写储存桶名称')
    expect(within(dialog).getByLabelText(/名称/)).toHaveFocus()
    expect(within(dialog).getByLabelText(/Secret Access Key/)).toHaveAttribute('type', 'password')
  })

  it('编辑时密钥留空表示不修改，并展示掩码而非明文', async () => {
    server.use(storageBucketListHandler([localBucketFixture, s3BucketFixture]))
    renderPanel()
    const row = await screen.findByRole('row', { name: /生产附件桶/ })
    await userEvent.click(within(row).getByRole('button', { name: '编辑' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/当前 Access Key：AKIA\*\*\*ABCD/)).toBeInTheDocument()
    const secret = within(dialog).getByLabelText(/Secret Access Key/)
    expect(secret).toHaveValue('')
    expect(within(dialog).getByLabelText(/Access Key ID/)).toHaveValue('')
  })
})
