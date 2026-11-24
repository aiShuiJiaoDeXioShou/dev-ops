import { Readable } from 'node:stream'
import type { IncomingHttpHeaders } from 'node:http'
import type { FastifyReply, FastifyRequest } from 'fastify'
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
  conversationAttachmentParamsSchema,
  conversationMessageAttachmentParamsSchema,
  projectAttachmentParamsSchema,
} from './attachments.schema.ts'
import type { AttachmentDownload, AttachmentsService } from './attachments.service.ts'

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

function sendDownload(reply: FastifyReply, download: AttachmentDownload) {
  return reply
    .header('Content-Type', 'application/octet-stream')
    .header('Content-Disposition', contentDisposition(download.fileName))
    .header('Content-Length', String(download.sizeBytes))
    .header('X-Content-SHA256', download.sha256)
    .send(download.stream)
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
  const uploadRouteOptions = {
    config: { idempotency: false },
    bodyLimit: options.maxFileBytes + 1024 * 1024,
  }
  async function upload(request: FastifyRequest, scope: { projectId: string } | { conversationId: string }) {
    const stream = request.body instanceof Readable ? request.body : null
    try {
      const actor = await requireActor(request)
      if (!stream) {
        throw new ApiError(ERROR_CODES.ATTACHMENT_INVALID, '上传请求体必须是 application/octet-stream 流')
      }
      const result = await options.service.uploadAttachment(actor, {
        ...scope,
        fileNameHeader: headerValue(request.headers, 'x-file-name'),
        contentTypeHeader: headerValue(request.headers, 'x-file-type'),
        contentLengthHeader: headerValue(request.headers, 'content-length'),
        source: stream,
      })
      return success(result, request.id)
    } catch (error) {
      // 提前拒绝上传时仍需消费请求体，以便返回业务错误信封。
      if (stream) await drainRequestBody(stream)
      throw error
    }
  }

  app.post(
    '/projects/:projectId/attachments',
    {
      ...uploadRouteOptions,
      schema: {
        summary: '上传项目事项附件',
        params: projectAttachmentParamsSchema,
        response: { 200: attachmentUploadResponseSchema },
      },
    },
    (request) => upload(request, request.params),
  )
  app.post(
    '/bot-conversations/:conversationId/attachments',
    {
      ...uploadRouteOptions,
      schema: {
        summary: '上传会话临时附件',
        description: '以 application/octet-stream 上传会话临时附件，通过发送消息的 attachmentIds 绑定。',
        params: conversationAttachmentParamsSchema,
        response: { 200: attachmentUploadResponseSchema },
      },
    },
    (request) => upload(request, request.params),
  )

  app.get(
    '/attachments/policy',
    { schema: { summary: '读取附件上传策略', response: { 200: attachmentPolicyResponseSchema } } },
    async (request) => {
      await requireActor(request)
      return success(options.service.getPolicy(), request.id)
    },
  )

  app.get(
    '/attachments/:attachmentId/download',
    {
      schema: {
        summary: '下载项目事项附件',
        params: attachmentParamsSchema,
        description:
          '附件下载是已登记的文件传输显式例外：成功返回 application/octet-stream 流并带 X-Content-SHA256，失败仍返回 HTTP 200 + 统一 JSON 信封。',
      },
    },
    async (request, reply) => {
      const actor = await requireActor(request)
      const download = await options.service.openDownload(actor, request.params.attachmentId)
      return sendDownload(reply, download)
    },
  )

  app.get(
    '/bot-conversations/:conversationId/messages/:messageId/attachments/:attachmentId/download',
    {
      schema: {
        summary: '下载会话消息附件',
        params: conversationMessageAttachmentParamsSchema,
        description:
          '会话附件下载使用文件传输例外：成功返回 application/octet-stream 流与 X-Content-SHA256，失败返回 HTTP 200 与统一 JSON 信封。',
      },
    },
    async (request, reply) => {
      const actor = await requireActor(request)
      return sendDownload(reply, await options.service.openConversationDownload(actor, request.params))
    },
  )

  app.post(
    '/attachments/:attachmentId/remove',
    {
      schema: {
        summary: '删除附件',
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
