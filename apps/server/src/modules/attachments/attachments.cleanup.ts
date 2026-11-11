import type { Database } from '../../platform/database/client.ts'
import type { StorageAdapter } from '../storage/adapters/local.adapter.ts'
import type { StorageService } from '../storage/storage.service.ts'
import type { AttachmentLogSink } from './attachments.service.ts'
import type { AttachmentPolicy } from './attachments.policy.ts'
import {
  deleteExpiredTempAttachment,
  deleteRemovedAttachment,
  findExpiredTempAttachments,
  findRemovedAttachments,
} from './attachments.repository.ts'

/** 附件清理任务依赖。 */
export interface AttachmentCleanupOptions {
  db: Database
  storage: StorageService
  policy: Pick<AttachmentPolicy, 'tempRetentionHours'>
  log: AttachmentLogSink
  /** 单轮每类最多处理记录数；限制单轮工作量。 */
  batchSize?: number
}

/** 单轮清理结果，供 worker 记录数量。 */
export interface AttachmentCleanupResult {
  /** 本轮删除的超期临时附件记录数。 */
  expiredTempAttachments: number
  /** 本轮完成对象删除并清理记录的 removed 附件数。 */
  removedAttachments: number
  /** 对象删除失败次数；失败会由下一轮重试。 */
  failures: number
}

/** 附件清理任务。 */
export interface AttachmentCleanup {
  /** 执行一轮清理；内部逐个处理，单条失败不阻塞其余记录。 */
  runOnce(now?: Date): Promise<AttachmentCleanupResult>
}

/**
 * 创建附件清理任务。
 * @param options 数据库、储存服务、临时附件保留期、日志与批大小。
 * @returns 可周期性执行的清理用例。
 * @remarks 超期临时附件先条件删除记录再删除对象，避免与绑定并发时破坏已绑定文件；
 * removed 附件先删对象再条件删除记录，对象删除失败保留记录由下一轮重试。
 */
export function createAttachmentCleanup(options: AttachmentCleanupOptions): AttachmentCleanup {
  const { db, storage, policy, log } = options
  const batchSize = options.batchSize ?? 100

  async function adapterForBucket(bucketId: string, cache: Map<string, StorageAdapter>): Promise<StorageAdapter> {
    const cached = cache.get(bucketId)
    if (cached) return cached
    const adapter = await storage.adapterForBucketId(bucketId)
    cache.set(bucketId, adapter)
    return adapter
  }

  async function runOnce(now = new Date()): Promise<AttachmentCleanupResult> {
    const result: AttachmentCleanupResult = { expiredTempAttachments: 0, removedAttachments: 0, failures: 0 }
    const adapters = new Map<string, StorageAdapter>()
    const cutoff = new Date(now.getTime() - policy.tempRetentionHours * 60 * 60 * 1000)

    const expiredTempAttachments = await findExpiredTempAttachments(db, cutoff, batchSize)
    for (const candidate of expiredTempAttachments) {
      const claimed = await db.transaction(async (tx) =>
        deleteExpiredTempAttachment(tx, { attachmentId: candidate.id, cutoff }),
      )
      if (!claimed) continue
      result.expiredTempAttachments += 1
      try {
        const adapter = await adapterForBucket(candidate.bucket_id, adapters)
        await adapter.remove(candidate.storage_key)
      } catch (error) {
        result.failures += 1
        log('超期临时附件对象删除失败', {
          attachmentId: candidate.id,
          error: error instanceof Error ? error.message : '未知错误',
        })
      }
    }

    const removedAttachments = await findRemovedAttachments(db, batchSize)
    for (const candidate of removedAttachments) {
      try {
        const adapter = await adapterForBucket(candidate.bucket_id, adapters)
        await adapter.remove(candidate.storage_key)
        if (await deleteRemovedAttachment(db, candidate.id)) result.removedAttachments += 1
      } catch (error) {
        result.failures += 1
        log('待删除附件对象删除失败，下一轮重试', {
          attachmentId: candidate.id,
          error: error instanceof Error ? error.message : '未知错误',
        })
      }
    }

    return result
  }

  return { runOnce }
}
