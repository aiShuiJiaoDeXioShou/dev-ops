import { useState } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RequestError } from '@dev-ops/api-client'
import { createQueryClient } from '@/shared/api/query-client'
import { attachmentPolicyFixture, server, success } from '@/test/server'
import type { PendingAttachment, UploadedAttachment } from '../model/types'
import { AttachmentField } from './attachment-field'

interface MockUpload {
  file: File
  resolve: (attachment: UploadedAttachment) => void
  reject: (error: unknown) => void
  emitProgress: (progress: number) => void
  abort: ReturnType<typeof vi.fn>
}

const uploadMock = vi.hoisted(() => ({ calls: [] as MockUpload[] }))

vi.mock('../lib/upload', () => ({
  uploadAttachment: (input: { file: File }) => {
    let resolveUpload: (attachment: UploadedAttachment) => void = () => undefined
    let rejectUpload: (error: unknown) => void = () => undefined
    let progressListener: (progress: number) => void = () => undefined
    const promise = new Promise<UploadedAttachment>((resolve, reject) => {
      resolveUpload = resolve
      rejectUpload = reject
    })
    const abort = vi.fn()
    uploadMock.calls.push({
      file: input.file,
      resolve: resolveUpload,
      reject: rejectUpload,
      emitProgress: (progress) => progressListener(progress),
      abort,
    })
    return {
      promise,
      abort,
      onProgress: (listener: (progress: number) => void) => {
        progressListener = listener
      },
    }
  },
  isUploadAborted: (error: unknown) => error instanceof Error && error.name === 'UploadAbortedError',
}))

/** 构造上传成功返回的临时附件摘要。 */
function uploadedAttachment(id = 'attachment-1', fileName = 'a.txt'): UploadedAttachment {
  return {
    id,
    fileName,
    sizeBytes: 5,
    contentType: 'text/plain',
    sha256: 'a'.repeat(64),
    status: 'temp',
    uploadedAt: '2026-11-11T00:00:00.000Z',
  }
}

/** 覆盖策略响应；用于验证上限前置校验。 */
function usePolicy(overrides: Partial<typeof attachmentPolicyFixture>) {
  server.use(http.get('*/api/v1/attachments/policy', () => success({ ...attachmentPolicyFixture, ...overrides })))
}

function Harness({ disabled = false }: { disabled?: boolean }) {
  const [value, setValue] = useState<PendingAttachment[]>([])
  return (
    <AttachmentField projectId="project-1" value={value} onChange={setValue} label="附件文件" disabled={disabled} />
  )
}

/** 渲染受控附件区，并等待策略加载完成使选择入口可用。 */
async function renderReadyField(options: { disabled?: boolean } = {}) {
  const user = userEvent.setup()
  render(
    <QueryClientProvider client={createQueryClient()}>
      <Harness disabled={options.disabled} />
    </QueryClientProvider>,
  )
  const input = (await screen.findByLabelText('选择文件')) as HTMLInputElement
  await waitFor(() => expect(input).not.toBeDisabled())
  return { user, input }
}

/** 选择若干文件，触发组件的前置校验与上传流程。 */
function chooseFiles(input: HTMLInputElement, files: File[]) {
  fireEvent.change(input, { target: { files } })
}

beforeEach(() => {
  uploadMock.calls.length = 0
})

describe('AttachmentField', () => {
  it('零字节文件在上传前被拒绝，不发起请求', async () => {
    const { input } = await renderReadyField()
    chooseFiles(input, [new File([], '空文件.txt')])
    expect(await screen.findByRole('alert')).toHaveTextContent('为空，无法上传')
    expect(uploadMock.calls).toHaveLength(0)
  })

  it('超过单文件上限时拒绝并给出限制值与文件名', async () => {
    usePolicy({ maxFileBytes: 8 })
    const { input } = await renderReadyField()
    chooseFiles(input, [new File(['0123456789'], 'big.bin')])
    expect(await screen.findByRole('alert')).toHaveTextContent('文件「big.bin」超过单文件上限 8 B。')
    expect(uploadMock.calls).toHaveLength(0)
  })

  it('超过单次数量上限时只上传可达数量并说明上限', async () => {
    usePolicy({ maxFilesPerSubmit: 1 })
    const { input } = await renderReadyField()
    chooseFiles(input, [new File(['a'], 'a.txt'), new File(['b'], 'b.txt')])
    expect(await screen.findByRole('alert')).toHaveTextContent('一次最多上传 1 个附件。')
    await waitFor(() => expect(uploadMock.calls).toHaveLength(1))
    expect(uploadMock.calls[0]?.file.name).toBe('a.txt')
  })

  it('上传中显示进度并在完成后进入已上传状态', async () => {
    const { input } = await renderReadyField()
    chooseFiles(input, [new File(['hello'], 'a.txt')])
    await waitFor(() => expect(uploadMock.calls).toHaveLength(1))
    act(() => {
      uploadMock.calls[0]?.emitProgress(42)
    })
    expect(await screen.findByRole('progressbar', { name: /上传进度 42%/ })).toBeInTheDocument()
    await act(async () => {
      uploadMock.calls[0]?.resolve(uploadedAttachment())
    })
    expect(await screen.findByText(/已上传/)).toBeInTheDocument()
  })

  it('取消上传调用 abort 并从列表移除该行', async () => {
    const { user, input } = await renderReadyField()
    chooseFiles(input, [new File(['hello'], 'a.txt')])
    await waitFor(() => expect(uploadMock.calls).toHaveLength(1))
    await user.click(screen.getByRole('button', { name: '取消上传 a.txt' }))
    expect(uploadMock.calls[0]?.abort).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('a.txt')).not.toBeInTheDocument()
  })

  it('失败后展示原因，重试复用同一行且不产生重复附件', async () => {
    const { user, input } = await renderReadyField()
    chooseFiles(input, [new File(['hello'], 'a.txt')])
    await waitFor(() => expect(uploadMock.calls).toHaveLength(1))
    await act(async () => {
      uploadMock.calls[0]?.reject(
        new RequestError('上传未完成', {
          code: 'BUSINESS_ERROR',
          status: 200,
          serverCode: 'ATTACHMENT_STORAGE_UNAVAILABLE',
          requestId: 'trace',
          responseValid: true,
        }),
      )
    })
    expect(await screen.findByText('附件存储暂时不可用，请联系平台管理员。')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '重试 a.txt' }))
    await waitFor(() => expect(uploadMock.calls).toHaveLength(2))
    expect(uploadMock.calls[1]?.file).toBe(uploadMock.calls[0]?.file)
    await act(async () => {
      uploadMock.calls[1]?.resolve(uploadedAttachment())
    })
    expect(await screen.findByText(/已上传/)).toBeInTheDocument()
    expect(screen.getAllByText('a.txt')).toHaveLength(1)
  })

  it('移除已完成附件后不进入提交集合', async () => {
    const { user, input } = await renderReadyField()
    chooseFiles(input, [new File(['hello'], 'a.txt')])
    await waitFor(() => expect(uploadMock.calls).toHaveLength(1))
    await act(async () => {
      uploadMock.calls[0]?.resolve(uploadedAttachment())
    })
    await user.click(await screen.findByRole('button', { name: '移除 a.txt' }))
    expect(screen.queryByText('a.txt')).not.toBeInTheDocument()
  })

  it('只读态不提供选择入口并说明原因', async () => {
    render(
      <QueryClientProvider client={createQueryClient()}>
        <Harness disabled />
      </QueryClientProvider>,
    )
    expect(await screen.findByText(/当前状态不可修改附件/)).toBeInTheDocument()
    expect(screen.queryByLabelText('选择文件')).not.toBeInTheDocument()
  })

  it('策略加载失败时禁用选择并展示重试入口', async () => {
    server.use(
      http.get('*/api/v1/attachments/policy', () =>
        HttpResponse.json(
          { success: false, code: 'FORBIDDEN', message: '无权限', requestId: 'trace' },
          { headers: { 'x-request-id': 'trace' } },
        ),
      ),
    )
    render(
      <QueryClientProvider client={createQueryClient()}>
        <Harness />
      </QueryClientProvider>,
    )
    expect(await screen.findByText('当前角色无权执行该操作。')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '选择文件' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '重试读取限制' })).toBeInTheDocument()
  })
})
