import { Type } from 'typebox'
import { apiResponseSchema } from '../../platform/http/response.ts'

const uuidSchema = Type.String({ format: 'uuid' })

/** 项目附件上传路由参数。 */
export const projectAttachmentParamsSchema = Type.Object({ projectId: uuidSchema })

/** 会话暂存附件的路由参数。 */
export const conversationAttachmentParamsSchema = Type.Object({ conversationId: uuidSchema })

/** 已发送附件必须按可见的具体消息读取。 */
export const conversationMessageAttachmentParamsSchema = Type.Object({
  conversationId: uuidSchema,
  messageId: uuidSchema,
  attachmentId: uuidSchema,
})

/** 单个附件标识路由参数。 */
export const attachmentParamsSchema = Type.Object({ attachmentId: uuidSchema })

const attachmentUploadViewSchema = Type.Object({
  attachment: Type.Object({
    id: uuidSchema,
    fileName: Type.String(),
    sizeBytes: Type.Integer(),
    contentType: Type.Union([Type.String(), Type.Null()]),
    sha256: Type.String(),
    status: Type.Literal('temp'),
    uploadedAt: Type.String(),
  }),
})

/** 上传附件成功响应。 */
export const attachmentUploadResponseSchema = apiResponseSchema(attachmentUploadViewSchema)

const attachmentPolicySchema = Type.Object({
  maxFileBytes: Type.Integer(),
  maxFilesPerSubmit: Type.Integer(),
  maxFilesPerRecord: Type.Integer(),
  tempRetentionHours: Type.Integer(),
})

/** 附件策略响应；上限来自集中配置。 */
export const attachmentPolicyResponseSchema = apiResponseSchema(attachmentPolicySchema)

const attachmentRemoveResultSchema = Type.Object({
  id: uuidSchema,
  removed: Type.Literal(true),
})

/** 删除附件成功响应。 */
export const attachmentRemoveResponseSchema = apiResponseSchema(attachmentRemoveResultSchema)
