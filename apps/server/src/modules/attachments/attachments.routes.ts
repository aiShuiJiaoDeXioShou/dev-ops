import { Readable } from 'node:stream'
import type { IncomingHttpHeaders } from 'node:http'
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { ERROR_CODES } from '../../platform/http/error-codes.ts'
import { ApiError } from '../../platform/http/errors.ts'
import { success } from '../../platform/http/response.ts'
import { requireActor } from '../identity/identity.actor.ts'
import type { IdentityAuth } from '../identity/identity.auth.ts'
import {
  attachmentParamsSchema,
  attachmentPolicyResponseSchema,
  attachmentRemoveResponseSchema,
  attachmentUploadResponseSchema,
  projectAttachmentParamsSchema,
} from './attachments.schema.ts'
import type { AttachmentsService } from './attachments.service.ts'

/** 附件路由依赖。 */
export interface AttachmentRoutesOptions {
  auth: IdentityAuth
  service: AttachmentsService
  /** 单文件上限；路由级 bodyLimit 比业务上限多留 1 MB，让超限请求进入业务错误。 */
  maxFileBytes: number
}

/** 读取单值请求头；重复头取第一个。 */
function headerValue(headers: IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name]
  return Array.isArray(value) ? value[0] : value
}

/** 构造 Content-Disposition 附件文件名；中文名使用 UTF-8 编码参数。 */
function contentDisposition(fileName: string): string {
  const fallback = fileName.replace(/[^A-Za-z0-9._-]/g, '_') || 'attachment'
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`
}

/**
 * 丢弃剩余请求体，保证提前返回业务错误时连接不被重置。
 * @param stream 原始请求流。
 * @returns 请求体消费完成或流已关闭后完成。
 */
async function drainRequestBody(stream: Readable): Promise<void> {
  if (stream.readableEnded || stream.destroyed) return
  stream.resume()
  await new Promise<void>((resolve) => {
    stream.once('end', resolve)
    stream.once('close', resolve)
    stream.once('error', resolve)
  })
}

/**
 * 注册附件路由：原始流上传、策略、下载与删除。
 * @param app Fastify 实例，已挂载 `/api/v1` 前缀。
 * @param options 附件服务、单文件上限与身份依赖。
 * @remarks 上传路由跳过全局幂等钩子：流式请求体无法稳定哈希，冲突时也不会 drain 请求体。
 * 下载是继流水线产物之后的第二条例外：成功返回二进制流，失败仍返回 HTTP 200 + 统一信封。
 */
export const attachmentRoutes: FastifyPluginAsyncTypebox<AttachmentRoutesOptions> = async (app, options) => {
  app.post(
    '/projects/:projectId/attachments',
    {
      config: { idempotency: false },
      bodyLimit: options.maxFileBytes + 1024 * 1024,
      schema: {
        params: projectAttachmentParamsSchema,
        response: { 200: attachmentUploadResponseSchema },
      },
    },
    async (request) => {
      const stream = request.body instanceof Readable ? request.body : null
      try {
        const actor = await requireActor(request)
        if (!stream) {
          throw new ApiError(ERROR_CODES.ATTACHMENT_INVALID, '上传请求体必须是 application/octet-stream 流')
        }
        const result = await options.service.uploadAttachment(actor, {
          projectId: request.params.projectId,
          fileNameHeader: headerValue(request.headers, 'x-file-name'),
          contentTypeHeader: headerValue(request.headers, 'x-file-type'),
          contentLengthHeader: headerValue(request.headers, 'content-length'),
          source: stream,
        })
        return success(result, request.id)
      } catch (error) {
        // 超限、权限或元信息错误可能发生在读取请求体之前；先 drain 再回信封，避免连接重置。
        if (stream) await drainRequestBody(stream)
        throw error
      }
    },
  )

  app.get('/attachments/policy', { schema: { response: { 200: attachmentPolicyResponseSchema } } }, async (request) => {
    await requireActor(request)
    return success(options.service.getPolicy(), request.id)
  })

  app.get(
    '/attachments/:attachmentId/download',
    {
      schema: {
        params: attachmentParamsSchema,
        description:
          '附件下载是已登记的文件传输显式例外：成功返回 application/octet-stream 流并带 X-Content-SHA256，失败仍返回 HTTP 200 + 统一 JSON 信封。',
      },
    },
    async (request, reply) => {
      const actor = await requireActor(request)
      const download = await options.service.openDownload(actor, request.params.attachmentId)
      return reply
        .header('Content-Type', 'application/octet-stream')
        .header('Content-Disposition', contentDisposition(download.fileName))
        .header('Content-Length', String(download.sizeBytes))
        .header('X-Content-SHA256', download.sha256)
        .send(download.stream)
    },
  )

  app.post(
    '/attachments/:attachmentId/remove',
    {
      schema: {
        params: attachmentParamsSchema,
        response: { 200: attachmentRemoveResponseSchema },
      },
    },
    async (request) => {
      const actor = await requireActor(request)
      return success(await options.service.removeAttachment(actor, request.params.attachmentId), request.id)
    },
  )
}
