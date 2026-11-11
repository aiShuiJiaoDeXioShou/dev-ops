import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { truncateFileName } from '../lib/display'
import type { AttachmentSummary } from '../model/types'
import { AttachmentList } from './attachment-list'

/** 构造详情附件摘要；默认上传者可正常下载，删除权限由用例单独传入。 */
function attachment(overrides: Partial<AttachmentSummary> = {}): AttachmentSummary {
  return {
    id: 'attachment-1',
    fileName: '复现截图.png',
    sizeBytes: 1_572_864,
    contentType: 'image/png',
    sha256: 'a'.repeat(64),
    uploadedBy: { userId: 'user-2', name: '李艳', status: 'active', available: true },
    createdAt: '2026-11-11T01:30:00.000Z',
    downloadUrl: '/api/v1/attachments/attachment-1/download',
    ...overrides,
  }
}

const allowAll = () => true
const allowNone = () => false

describe('AttachmentList', () => {
  it('加载中展示骨架，不显示空态', () => {
    render(<AttachmentList attachments={[]} loading canDelete={allowAll} onDelete={vi.fn()} />)
    expect(screen.getByText('附件加载中…')).toBeInTheDocument()
    expect(screen.queryByText('暂无附件。')).not.toBeInTheDocument()
  })

  it('空列表展示空态', () => {
    render(<AttachmentList attachments={[]} canDelete={allowAll} onDelete={vi.fn()} />)
    expect(screen.getByText('暂无附件。')).toBeInTheDocument()
  })

  it('加载失败展示原因并提供重试', async () => {
    const onRetry = vi.fn()
    render(
      <AttachmentList
        attachments={[]}
        error="附件加载失败。"
        onRetry={onRetry}
        canDelete={allowAll}
        onDelete={vi.fn()}
      />,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('附件加载失败。')
    await userEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('展示文件名、大小、上传者、时间与受鉴权下载链接', () => {
    const longName = `${'a'.repeat(60)}.png`
    render(
      <AttachmentList attachments={[attachment({ fileName: longName })]} canDelete={allowAll} onDelete={vi.fn()} />,
    )
    expect(screen.getByText(truncateFileName(longName))).toBeInTheDocument()
    expect(screen.getByText(/1.5 MB/)).toBeInTheDocument()
    expect(screen.getByText(/李艳/)).toBeInTheDocument()
    const download = screen.getByRole('link', { name: '下载' })
    expect(download).toHaveAttribute('href', '/api/v1/attachments/attachment-1/download')
    expect(download).toHaveAttribute('download', longName)
  })

  it('上传者失效时保留附件并标注，不隐藏历史数据', () => {
    render(
      <AttachmentList
        attachments={[
          attachment({ uploadedBy: { userId: 'user-9', name: '已离队', status: 'missing', available: false } }),
        ]}
        canDelete={allowAll}
        onDelete={vi.fn()}
      />,
    )
    expect(screen.getByText(/上传者已失效/)).toBeInTheDocument()
  })

  it('canDelete 为 false 时不展示删除入口', () => {
    render(<AttachmentList attachments={[attachment()]} canDelete={allowNone} onDelete={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /删除附件/ })).not.toBeInTheDocument()
  })

  it('删除前二次确认，说明不可恢复且默认焦点不落在危险按钮', async () => {
    const user = userEvent.setup()
    const onDelete = vi.fn()
    render(<AttachmentList attachments={[attachment()]} canDelete={allowAll} onDelete={onDelete} />)
    await user.click(screen.getByRole('button', { name: '删除附件 复现截图.png' }))
    expect(await screen.findByRole('alertdialog')).toHaveTextContent('删除后不可恢复')
    const cancelButton = screen.getByRole('button', { name: '取消' })
    await waitFor(() => expect(cancelButton).toHaveFocus())
    await user.click(screen.getByRole('button', { name: '删除' }))
    expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({ id: 'attachment-1' }))
  })

  it('删除中禁用按钮，删除失败保留列表并提示原因', () => {
    render(
      <AttachmentList
        attachments={[attachment()]}
        canDelete={allowAll}
        onDelete={vi.fn()}
        deletingId="attachment-1"
        deleteError="当前角色无权执行该操作。"
      />,
    )
    expect(screen.getByRole('button', { name: '删除附件 复现截图.png' })).toBeDisabled()
    expect(screen.getByText('当前角色无权执行该操作。')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '下载' })).toBeInTheDocument()
  })
})
