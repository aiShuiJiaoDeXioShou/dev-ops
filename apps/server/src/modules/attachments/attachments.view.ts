import type { OwnerRef } from '../identity/identity.display.ts'
import type { AttachmentRow } from './attachments.repository.ts'
import type { AttachmentStatus, AttachmentTargetType } from './attachments.tables.ts'

/**
 * 判断数据库 text 值是否为合法附件状态。
 * @param value 数据库读出的状态文本。
 * @returns 是否属于 temp / bound / removed。
 */
export function isAttachmentStatus(value: string): value is AttachmentStatus {
  return value === 'temp' || value === 'bound' || value === 'removed'
}

/**
 * 判断数据库 text 值是否为合法附件目标类型。
 * @param value 数据库读出的目标类型文本。
 * @returns 是否属于 requirement / bug。
 */
export function isAttachmentTargetType(value: string): value is AttachmentTargetType {
  return value === 'requirement' || value === 'bug'
}

/** 上传成功返回的附件摘要；不包含对象键与桶标识。 */
export interface AttachmentUploadView {
  id: string
  fileName: string
  sizeBytes: number
  contentType: string | null
  sha256: string
  status: 'temp'
  uploadedAt: string
}

/** 业务详情中展示的附件摘要。 */
export interface AttachmentSummary {
  id: string
  fileName: string
  sizeBytes: number
  contentType: string | null
  sha256: string
  uploadedBy: OwnerRef
  createdAt: string
  downloadUrl: string
}

/**
 * 构造附件下载地址。
 * @param attachmentId 附件标识。
 * @returns 受鉴权的下载路径，供详情响应使用。
 */
export function attachmentDownloadUrl(attachmentId: string): string {
  return `/api/v1/attachments/${attachmentId}/download`
}

/**
 * 将临时附件行映射为上传响应摘要。
 * @param row 附件记录行。
 * @returns 上传成功摘要。
 * @throws 数据库状态不是 temp 时抛出普通错误，表示数据异常而不是用户输入问题。
 */
export function toAttachmentUploadView(row: AttachmentRow): AttachmentUploadView {
  if (!isAttachmentStatus(row.status) || row.status !== 'temp') throw new Error('新建附件状态不合法')
  return {
    id: row.id,
    fileName: row.file_name,
    sizeBytes: row.size_bytes,
    contentType: row.content_type,
    sha256: row.sha256,
    status: row.status,
    uploadedAt: row.created_at.toISOString(),
  }
}

/**
 * 将已绑定附件行映射为详情摘要。
 * @param row 附件记录行。
 * @param uploadedBy 上传者展示引用。
 * @returns 详情附件摘要，含受鉴权下载地址。
 * @throws 数据库状态不是 bound 时抛出普通错误，表示数据异常。
 */
export function toAttachmentSummary(row: AttachmentRow, uploadedBy: OwnerRef): AttachmentSummary {
  if (!isAttachmentStatus(row.status) || row.status !== 'bound') throw new Error('已绑定附件状态不合法')
  return {
    id: row.id,
    fileName: row.file_name,
    sizeBytes: row.size_bytes,
    contentType: row.content_type,
    sha256: row.sha256,
    uploadedBy,
    createdAt: row.created_at.toISOString(),
    downloadUrl: attachmentDownloadUrl(row.id),
  }
}
