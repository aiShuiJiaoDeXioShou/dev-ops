import type { AttachmentSummary, PendingAttachment } from '../model/types'

/**
 * 把详情中的已绑定附件转换为表单行；这些行已上传完成，只参与最终集合的增删。
 * @param attachments 详情接口返回的附件摘要。
 * @returns 状态为 done 的待提交附件行；clientId 保留服务端标识，便于定位移除项。
 */
export function toPendingAttachments(attachments: AttachmentSummary[]): PendingAttachment[] {
  return attachments.map((attachment) => ({
    clientId: `saved-${attachment.id}`,
    fileName: attachment.fileName,
    sizeBytes: attachment.sizeBytes,
    status: 'done',
    progress: 100,
    attachmentId: attachment.id,
  }))
}

/**
 * 判断是否仍有未完成的附件；存在上传中或上传失败的附件时不能提交业务表单。
 * @param attachments 表单中的附件行。
 * @returns 是否存在 uploading/failed 行。
 */
export function hasUnfinishedAttachments(attachments: PendingAttachment[]): boolean {
  return attachments.some((attachment) => attachment.status !== 'done')
}

/**
 * 提取提交用的附件标识集合。
 * @param attachments 表单中的附件行。
 * @returns 已上传完成且带服务端标识的附件 ID，保持行顺序；创建时为本次上传集合，编辑时为最终保留集合。
 */
export function doneAttachmentIds(attachments: PendingAttachment[]): string[] {
  const attachmentIds: string[] = []
  for (const attachment of attachments) {
    if (attachment.status === 'done' && attachment.attachmentId) attachmentIds.push(attachment.attachmentId)
  }
  return attachmentIds
}
