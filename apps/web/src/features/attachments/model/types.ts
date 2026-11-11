import type { ApiSuccessData } from '@dev-ops/api-client'

/** 业务详情中展示的附件摘要；结构与服务端详情契约一致。 */
export type AttachmentSummary = ApiSuccessData<'/api/v1/requirements/{requirementId}', 'get'>['attachments'][number]

/** 上传成功返回的附件摘要；仅在上传响应中使用，不含下载地址。 */
export type UploadedAttachment = ApiSuccessData<'/api/v1/projects/{projectId}/attachments', 'post'>['attachment']

/** 附件策略上限；由服务端集中配置下发，前端不硬编码。 */
export type AttachmentPolicy = ApiSuccessData<'/api/v1/attachments/policy', 'get'>

/** 表单中的附件行状态；clientId 在重试时保持不变，用于复用同一行。 */
export interface PendingAttachment {
  /** 前端本地标识；重试与进度更新都按它定位同一行。 */
  clientId: string
  /** 用户选择的原始文件名。 */
  fileName: string
  /** 文件字节数，用于展示与上限提示。 */
  sizeBytes: number
  /** 上传状态；只有 done 的附件会进入提交集合。 */
  status: 'uploading' | 'failed' | 'done'
  /** 0–100 的上传进度，仅 uploading 时有意义。 */
  progress: number
  /** 上传成功后由服务端返回的附件标识。 */
  attachmentId?: string
  /** 失败原因，用于行内展示与重试提示。 */
  error?: string
}
