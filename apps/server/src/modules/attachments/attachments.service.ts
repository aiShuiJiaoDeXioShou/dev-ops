import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Readable } from 'node:stream'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { Database } from '../../platform/database/client.ts'
import { ERROR_CODES } from '../../platform/http/error-codes.ts'
import { ApiError } from '../../platform/http/errors.ts'
import type { StorageAdapter } from '../storage/adapters/local.adapter.ts'
import type { StorageBucketRow, StorageService } from '../storage/storage.service.ts'
import type { SessionUser } from '../identity/identity.session.ts'
import { requireTeamMember } from '../identity/identity.session.ts'
import { getProjectContext } from '../projects/projects.access.ts'
import { appendActivity } from '../collaboration/collaboration.service.ts'
import {
  normalizeAttachmentFileName,
  parseAttachmentContentLength,
  type AttachmentPolicy,
} from './attachments.policy.ts'
import {
  deleteRemovedAttachment,
  deleteTempAttachmentRecord,
  findAttachmentById,
  insertAttachment,
  markAttachmentRemoved,
  type AttachmentRow,
} from './attachments.repository.ts'
import { resolveAttachmentDeleteAuthority } from './attachments.binding.ts'
import { isAttachmentStatus, toAttachmentUploadView, type AttachmentUploadView } from './attachments.view.ts'

/** 结构化告警日志；用于记录清理失败等无法转化为业务结果的问题。 */
export type AttachmentLogSink = (message: string, context?: Record<string, unknown>) => void

/** 附件服务依赖。 */
export interface AttachmentsServiceOptions {
  db: Database
  storage: StorageService
  policy: AttachmentPolicy
  /** 记录对象清理失败等告警；省略时由调用方补充日志。 */
  log?: AttachmentLogSink
}

/** 原始流上传请求；请求头由路由原样传入，解析与校验集中在服务层。 */
export interface AttachmentUploadRequest {
  projectId: string
  /** `X-File-Name`，URI 编码的 UTF-8 文件名。 */
  fileNameHeader: string | undefined
  /** `X-File-Type`，仅作展示的原始 MIME。 */
  contentTypeHeader: string | undefined
  /** `Content-Length` 请求头原值。 */
  contentLengthHeader: string | undefined
  source: Readable
}

/** 上传成功结果。 */
export interface AttachmentUploadResult {
  attachment: AttachmentUploadView
}

/** 下载所需的文件元信息与对象流。 */
export interface AttachmentDownload {
  fileName: string
  contentType: string
  sizeBytes: number
  sha256: string
  stream: Readable
}

const DEFAULT_CONTENT_TYPE = 'application/octet-stream'
const MAX_CONTENT_TYPE_LENGTH = 255

/** 附件服务的公开用例。 */
export interface AttachmentsService {
  /** 读取当前附件策略，供前端展示上限。 */
  getPolicy(): AttachmentPolicy
  /** 上传临时附件；成功后返回摘要。 */
  uploadAttachment(actor: SessionUser, request: AttachmentUploadRequest): Promise<AttachmentUploadResult>
  /** 打开附件下载流；项目成员可下载，removed 附件视为不存在。 */
  openDownload(actor: SessionUser, attachmentId: string): Promise<AttachmentDownload>
  /** 删除附件；事务内置 removed，对象删除在提交后执行。 */
  removeAttachment(actor: SessionUser, attachmentId: string): Promise<{ id: string; removed: true }>
}

/** 解码文件名请求头；编码非法时返回业务错误而不是 500。 */
function decodeFileNameHeader(raw: string | undefined): string {
  if (!raw) throw new ApiError(ERROR_CODES.ATTACHMENT_INVALID, '缺少 X-File-Name，无法上传附件')
  try {
    return decodeURIComponent(raw)
  } catch {
    throw new ApiError(ERROR_CODES.ATTACHMENT_INVALID, 'X-File-Name 编码不合法')
  }
}

/** 规范化文件 MIME；仅作展示，不参与安全判定。 */
function normalizeContentType(raw: string | undefined): string | null {
  if (!raw) return DEFAULT_CONTENT_TYPE
  const value = raw.trim()
  if (value.length === 0) return DEFAULT_CONTENT_TYPE
  if (value.length > MAX_CONTENT_TYPE_LENGTH) {
    throw new ApiError(ERROR_CODES.ATTACHMENT_INVALID, '文件类型长度不能超过 255 个字符')
  }
  return value
}

/** 流式写入临时文件并计算 SHA-256；超过声明字节数立即中止。 */
async function writeTempFile(
  source: Readable,
  filePath: string,
  declaredSize: number,
): Promise<{ sizeBytes: number; sha256: string }> {
  const hash = createHash('sha256')
  let written = 0
  const meter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      written += chunk.length
      if (written > declaredSize) {
        callback(new ApiError(ERROR_CODES.ATTACHMENT_LIMIT_EXCEEDED, '上传内容超过声明的字节数'))
        return
      }
      hash.update(chunk)
      callback(null, chunk)
    },
  })
  await pipeline(source, meter, createWriteStream(filePath))
  if (written !== declaredSize) {
    throw new ApiError(ERROR_CODES.ATTACHMENT_INVALID, '上传字节数与 Content-Length 不一致')
  }
  return { sizeBytes: written, sha256: hash.digest('hex') }
}

/**
 * 创建附件服务。
 * @param options 数据库、储存服务、策略与可选日志。
 * @returns 上传、下载、删除与策略用例；绑定/解绑用例见 `attachments.binding.ts`。
 * @remarks 事务内只写数据库与活动；对象写入在事务前完成，对象删除在提交后执行，避免事务包含外部 I/O。
 */
export function createAttachmentsService(options: AttachmentsServiceOptions): AttachmentsService {
  const { db, storage, policy, log } = options

  async function requireProjectWrite(actor: SessionUser, projectId: string) {
    const project = await getProjectContext(db, projectId)
    if (!project) throw new ApiError(ERROR_CODES.NOT_FOUND, '项目不存在')
    await requireTeamMember(db, actor.id, project.teamId, ['admin', 'developer'])
    return project
  }

  async function resolveDefaultBucket(): Promise<StorageBucketRow> {
    try {
      return await storage.resolveDefaultBucket()
    } catch (error) {
      log?.('解析默认附件储存桶失败', { error: error instanceof Error ? error.message : '未知错误' })
      throw new ApiError(ERROR_CODES.ATTACHMENT_STORAGE_UNAVAILABLE, '附件储存桶不可用，请联系平台管理员')
    }
  }

  async function removeObjectQuietly(adapter: StorageAdapter, storageKey: string): Promise<void> {
    try {
      await adapter.remove(storageKey)
    } catch (error) {
      log?.('附件对象清理失败，可能留下孤儿对象', {
        storageKey,
        error: error instanceof Error ? error.message : '未知错误',
      })
    }
  }

  async function uploadAttachment(
    actor: SessionUser,
    request: AttachmentUploadRequest,
  ): Promise<AttachmentUploadResult> {
    const project = await requireProjectWrite(actor, request.projectId)
    const contentLength = parseAttachmentContentLength(request.contentLengthHeader, policy.maxFileBytes)
    const fileName = normalizeAttachmentFileName(decodeFileNameHeader(request.fileNameHeader))
    const contentType = normalizeContentType(request.contentTypeHeader)
    const bucket = await resolveDefaultBucket()
    const attachmentId = randomUUID()
    const storageKey = storage.attachmentStorageKey({
      teamId: project.teamId,
      projectId: project.id,
      attachmentId,
    })
    const tempDir = await mkdtemp(join(tmpdir(), 'dev-ops-attachment-'))
    try {
      const tempFilePath = join(tempDir, 'upload.bin')
      let written: { sizeBytes: number; sha256: string }
      try {
        written = await writeTempFile(request.source, tempFilePath, contentLength)
      } catch (error) {
        if (error instanceof ApiError) throw error
        log?.('附件临时文件写入失败', { error: error instanceof Error ? error.message : '未知错误' })
        throw new ApiError(ERROR_CODES.ATTACHMENT_STORAGE_UNAVAILABLE, '附件写入失败，请稍后重试')
      }

      let adapter: StorageAdapter
      try {
        adapter = storage.adapterFor(bucket)
      } catch (error) {
        log?.('构造附件储存桶适配器失败', {
          bucketId: bucket.id,
          error: error instanceof Error ? error.message : '未知错误',
        })
        throw new ApiError(ERROR_CODES.ATTACHMENT_STORAGE_UNAVAILABLE, '附件储存桶不可用，请联系平台管理员')
      }

      let stored: { sizeBytes: number; sha256: string }
      try {
        stored = await adapter.put(storageKey, createReadStream(tempFilePath), written.sizeBytes)
      } catch (error) {
        log?.('附件写入储存桶失败', { bucketId: bucket.id, error: error instanceof Error ? error.message : '未知错误' })
        throw new ApiError(ERROR_CODES.ATTACHMENT_STORAGE_UNAVAILABLE, '附件写入储存桶失败，请稍后重试')
      }
      if (stored.sizeBytes !== written.sizeBytes || stored.sha256 !== written.sha256) {
        await removeObjectQuietly(adapter, storageKey)
        throw new ApiError(ERROR_CODES.ATTACHMENT_STORAGE_UNAVAILABLE, '附件写入校验失败，请稍后重试')
      }

      let row: AttachmentRow
      try {
        row = await db.transaction(async (tx) => {
          const inserted = await insertAttachment(tx, {
            id: attachmentId,
            teamId: project.teamId,
            projectId: project.id,
            bucketId: bucket.id,
            storageKey,
            fileName,
            sizeBytes: written.sizeBytes,
            contentType,
            sha256: written.sha256,
            uploadedByUserId: actor.id,
          })
          await appendActivity(tx, {
            teamId: project.teamId,
            projectId: project.id,
            entityType: 'attachment',
            entityId: inserted.id,
            action: 'attachment_uploaded',
            actorUserId: actor.id,
            changes: { fileName: inserted.file_name, sizeBytes: inserted.size_bytes },
          })
          return inserted
        })
      } catch (error) {
        await removeObjectQuietly(adapter, storageKey)
        throw error
      }

      return { attachment: toAttachmentUploadView(row) }
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  }

  async function openDownload(actor: SessionUser, attachmentId: string): Promise<AttachmentDownload> {
    const row = await findAttachmentById(db, attachmentId)
    if (!row) throw new ApiError(ERROR_CODES.ATTACHMENT_NOT_FOUND, '附件不存在或已被删除')
    const project = await getProjectContext(db, row.project_id)
    if (!project) throw new ApiError(ERROR_CODES.ATTACHMENT_NOT_FOUND, '附件不存在或已被删除')
    // 下载权限只要求项目成员（含浏览者）；跨团队与非成员一律拒绝。
    await requireTeamMember(db, actor.id, project.teamId)
    if (!isAttachmentStatus(row.status) || row.status === 'removed') {
      throw new ApiError(ERROR_CODES.ATTACHMENT_NOT_FOUND, '附件不存在或已被删除')
    }
    // 未绑定的临时附件只有上传者本人可见，其他成员按不存在处理，避免泄露文件名与内容。
    if (row.status === 'temp' && row.uploaded_by_user_id !== actor.id) {
      throw new ApiError(ERROR_CODES.ATTACHMENT_NOT_FOUND, '附件不存在或已被删除')
    }

    let stream: Readable
    try {
      const adapter = await storage.adapterForBucketId(row.bucket_id)
      stream = await adapter.get(row.storage_key)
    } catch (error) {
      if (error instanceof ApiError) throw error
      log?.('读取附件对象失败', { attachmentId: row.id, error: error instanceof Error ? error.message : '未知错误' })
      throw new ApiError(ERROR_CODES.ATTACHMENT_STORAGE_UNAVAILABLE, '附件存储暂不可用，请稍后重试')
    }
    return {
      fileName: row.file_name,
      contentType: row.content_type ?? DEFAULT_CONTENT_TYPE,
      sizeBytes: row.size_bytes,
      sha256: row.sha256,
      stream,
    }
  }

  async function removeAttachment(actor: SessionUser, attachmentId: string): Promise<{ id: string; removed: true }> {
    const row = await findAttachmentById(db, attachmentId)
    if (!row) throw new ApiError(ERROR_CODES.ATTACHMENT_NOT_FOUND, '附件不存在或已被删除')
    const project = await getProjectContext(db, row.project_id)
    if (!project) throw new ApiError(ERROR_CODES.ATTACHMENT_NOT_FOUND, '附件不存在或已被删除')
    // 临时附件只有上传者本人可删除；管理员与项目负责人也不能删除他人未提交的附件。
    if (row.status === 'temp' && row.uploaded_by_user_id !== actor.id) {
      throw new ApiError(ERROR_CODES.ATTACHMENT_NOT_FOUND, '附件不存在或已被删除')
    }
    const authority = await resolveAttachmentDeleteAuthority(db, {
      teamId: project.teamId,
      projectId: project.id,
      actorUserId: actor.id,
    })
    if (authority.role === 'viewer') throw new ApiError(ERROR_CODES.FORBIDDEN, '浏览者无权删除附件')
    const isUploader = row.uploaded_by_user_id === actor.id
    if (!authority.canDeleteAny && !isUploader) {
      throw new ApiError(ERROR_CODES.FORBIDDEN, '无权删除他人上传的附件')
    }
    if (!isAttachmentStatus(row.status) || row.status === 'removed') {
      throw new ApiError(ERROR_CODES.ATTACHMENT_NOT_FOUND, '附件不存在或已被删除')
    }

    // 未绑定的临时附件没有业务目标，数据库约束不允许置为 removed，只能直接删除记录。
    const isTempAttachment = row.status === 'temp'
    const removedRow = await db.transaction(async (tx) => {
      const removed = isTempAttachment
        ? await deleteTempAttachmentRecord(tx, row.id)
        : await markAttachmentRemoved(tx, row.id)
      if (!removed) throw new ApiError(ERROR_CODES.ATTACHMENT_STATE_CONFLICT, '附件状态已变化，请刷新后重试')
      await appendActivity(tx, {
        teamId: project.teamId,
        projectId: project.id,
        entityType: 'attachment',
        entityId: removed.id,
        action: 'attachment_removed',
        actorUserId: actor.id,
        changes: {
          fileName: removed.file_name,
          sizeBytes: removed.size_bytes,
          targetType: removed.target_type,
          targetId: removed.target_id,
        },
      })
      return removed
    })

    // 提交后才删除对象；失败保留 removed 记录，由清理任务重试，不影响已完成的删除语义。
    try {
      const adapter = await storage.adapterForBucketId(removedRow.bucket_id)
      await adapter.remove(removedRow.storage_key)
      if (!isTempAttachment) await deleteRemovedAttachment(db, removedRow.id)
    } catch (error) {
      log?.('附件对象删除失败，已保留待清理记录', {
        attachmentId: removedRow.id,
        error: error instanceof Error ? error.message : '未知错误',
      })
    }
    return { id: removedRow.id, removed: true }
  }

  return {
    getPolicy: () => ({ ...policy }),
    uploadAttachment,
    openDownload,
    removeAttachment,
  }
}
