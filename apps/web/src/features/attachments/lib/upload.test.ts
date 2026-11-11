import { http, HttpResponse, delay } from 'msw'
import { describe, expect, it } from 'vitest'
import { RequestError } from '@dev-ops/api-client'
import { server, success } from '@/test/server'
import { describeAttachmentError } from './errors'
import { isUploadAborted, uploadAttachment } from './upload'

/** 记录上传请求中可核对的头与字节数，避免测试只依赖返回结果。 */
interface CapturedUpload {
  fileName: string | null
  fileType: string | null
  contentType: string | null
  sizeBytes: number
}

describe('uploadAttachment', () => {
  it('以原始流上传并携带编码文件名、MIME 与固定 Content-Type', async () => {
    let captured: CapturedUpload | null = null
    server.use(
      http.post('*/api/v1/projects/project-1/attachments', async ({ request }) => {
        const body = await request.arrayBuffer()
        captured = {
          fileName: request.headers.get('x-file-name'),
          fileType: request.headers.get('x-file-type'),
          contentType: request.headers.get('content-type'),
          sizeBytes: body.byteLength,
        }
        return success({
          attachment: {
            id: 'attachment-1',
            fileName: '复现截图.png',
            sizeBytes: body.byteLength,
            contentType: 'image/png',
            sha256: 'a'.repeat(64),
            status: 'temp',
            uploadedAt: '2026-11-11T00:00:00.000Z',
          },
        })
      }),
    )
    const file = new File(['hello'], '复现截图.png', { type: 'image/png' })
    const attachment = await uploadAttachment({ projectId: 'project-1', file }).promise
    expect(attachment.id).toBe('attachment-1')
    expect(captured).toEqual({
      fileName: encodeURIComponent('复现截图.png'),
      fileType: 'image/png',
      contentType: 'application/octet-stream',
      sizeBytes: 5,
    })
  })

  it('缺省 MIME 时按 application/octet-stream 记录', async () => {
    let fileType: string | null = null
    server.use(
      http.post('*/api/v1/projects/project-1/attachments', ({ request }) => {
        fileType = request.headers.get('x-file-type')
        return success({
          attachment: {
            id: 'attachment-2',
            fileName: '日志.txt',
            sizeBytes: 1,
            contentType: null,
            sha256: 'b'.repeat(64),
            status: 'temp',
            uploadedAt: '2026-11-11T00:00:00.000Z',
          },
        })
      }),
    )
    await uploadAttachment({ projectId: 'project-1', file: new File(['x'], '日志.txt') }).promise
    expect(fileType).toBe('application/octet-stream')
  })

  it('业务失败按错误码映射为可读原因', async () => {
    server.use(
      http.post('*/api/v1/projects/project-1/attachments', () =>
        HttpResponse.json(
          {
            success: false,
            code: 'ATTACHMENT_STORAGE_UNAVAILABLE',
            message: '存储不可用',
            requestId: 'trace-1',
          },
          { headers: { 'x-request-id': 'trace-1' } },
        ),
      ),
    )
    const error = await uploadAttachment({
      projectId: 'project-1',
      file: new File(['x'], 'a.txt'),
    }).promise.catch((cause: unknown) => cause)
    expect(error).toBeInstanceOf(RequestError)
    expect(describeAttachmentError(error)).toBe('附件存储暂时不可用，请联系平台管理员。')
  })

  it('取消后以取消错误拒绝，调用方可静默移除该行', async () => {
    server.use(
      http.post('*/api/v1/projects/project-1/attachments', async () => {
        await delay(500)
        return success({
          attachment: {
            id: 'attachment-3',
            fileName: 'a.txt',
            sizeBytes: 1,
            contentType: null,
            sha256: 'c'.repeat(64),
            status: 'temp',
            uploadedAt: '2026-11-11T00:00:00.000Z',
          },
        })
      }),
    )
    const handle = uploadAttachment({ projectId: 'project-1', file: new File(['x'], 'a.txt') })
    const settled = handle.promise.catch((cause: unknown) => cause)
    handle.abort()
    const error = await settled
    expect(isUploadAborted(error)).toBe(true)
  })

  it('超过独立超时返回超时错误', async () => {
    server.use(
      http.post('*/api/v1/projects/project-1/attachments', async () => {
        await delay(1_000)
        return success({ attachment: { id: 'late' } })
      }),
    )
    const error = await uploadAttachment({
      projectId: 'project-1',
      file: new File(['x'], 'a.txt'),
      timeoutMs: 50,
    }).promise.catch((cause: unknown) => cause)
    expect(error).toBeInstanceOf(RequestError)
    expect(describeAttachmentError(error)).toBe('上传超时，请检查网络后重试。')
  })
})
