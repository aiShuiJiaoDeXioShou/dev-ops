import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import type { Database } from '../../platform/database/client.ts'
import { attachment } from '../attachments/attachments.tables.ts'
import { appendActivity } from '../collaboration/collaboration.service.ts'
import { pipelineArtifact } from '../pipeline/pipeline.tables.ts'
import type { PipelineStorage } from '../pipeline/pipeline.storage.ts'
import type { StorageService } from '../storage/storage.service.ts'
import { claimProjectFileCleanup, lockCleanupLease } from './projects.lifecycle.repository.ts'
import { projectFileCleanup } from './projects.lifecycle.tables.ts'

const BATCH_SIZE = 20

/**
 * 领取项目文件清理任务，处理一个有界批次。文件删除在事务外，数据库只在删除成功后记录进度。
 * @param options 数据库、文件适配器与日志回调。
 * @returns 处理了一个任务时返回 true；无任务时返回 false。
 * @remarks 租约过期后 Worker 可接管。对象键不会复用，重试删除已不存在的文件按成功处理。
 */
export async function runProjectFileCleanup(options: {
  db: Database
  storage: Pick<StorageService, 'adapterForBucketId'>
  pipelineStorage: Pick<PipelineStorage, 'removeArtifact'>
  log: (message: string, context: Record<string, unknown>) => void
}): Promise<boolean> {
  const { db, storage, pipelineStorage, log } = options
  const job = await claimProjectFileCleanup(db, new Date())
  if (!job) return false
  // 每次循环按标识稳定取未清理对象，保留原始元数据。已缺失产物也重试删除，避免遗留文件。
  const attachments = await db
    .select({ id: attachment.id, bucket: attachment.bucket_id, key: attachment.storage_key })
    .from(attachment)
    .where(and(eq(attachment.project_id, job.project_id), isNull(attachment.purged_at)))
    .orderBy(asc(attachment.id))
    .limit(BATCH_SIZE)
  const artifacts =
    attachments.length < BATCH_SIZE
      ? await db
          .select({ id: pipelineArtifact.id, bucket: sql<null>`null`, key: pipelineArtifact.storage_key })
          .from(pipelineArtifact)
          .where(and(eq(pipelineArtifact.project_id, job.project_id), isNull(pipelineArtifact.purged_at)))
          .orderBy(asc(pipelineArtifact.id))
          .limit(BATCH_SIZE - attachments.length)
      : []
  const files = [...attachments, ...artifacts]
  let nextStatus: 'queued' | 'succeeded' | 'failed' = files.length < BATCH_SIZE ? 'succeeded' : 'queued'
  for (const file of files) {
    // 从每个删除操作开始前检查租约，避免旧 Worker 继续发起下一项。
    const ownsLease = await db.transaction((tx) => lockCleanupLease(tx, job.id, job.token))
    if (!ownsLease) return true
    try {
      if (file.bucket !== null) await (await storage.adapterForBucketId(file.bucket)).remove(file.key)
      else await pipelineStorage.removeArtifact(file.key)
    } catch (cause) {
      log('项目文件清理失败', {
        jobId: job.id,
        projectId: job.project_id,
        errorType: cause instanceof Error ? cause.name : 'unknown',
      })
      nextStatus = 'failed'
      break
    }
    // 对象已删除但写库失败时保留运行状态，接管者补记进度后才允许恢复。
    const updated = await db.transaction(async (tx) => {
      if (!(await lockCleanupLease(tx, job.id, job.token))) return false
      const now = new Date()
      if (file.bucket !== null) {
        await tx
          .update(attachment)
          .set({ purged_at: now, updated_at: now })
          .where(
            and(eq(attachment.id, file.id), eq(attachment.project_id, job.project_id), isNull(attachment.purged_at)),
          )
      } else {
        await tx
          .update(pipelineArtifact)
          .set({ status: 'missing', purged_at: now, updated_at: now })
          .where(
            and(
              eq(pipelineArtifact.id, file.id),
              eq(pipelineArtifact.project_id, job.project_id),
              isNull(pipelineArtifact.purged_at),
            ),
          )
      }
      return true
    })
    if (!updated) return true
  }
  await db.transaction(async (tx) => {
    if (!(await lockCleanupLease(tx, job.id, job.token))) return
    await tx
      .update(projectFileCleanup)
      .set({
        status: nextStatus,
        lease_token: null,
        lease_until: null,
        updated_at: new Date(),
      })
      .where(eq(projectFileCleanup.id, job.id))
    if (nextStatus !== 'queued') {
      await appendActivity(tx, {
        teamId: job.team_id,
        projectId: job.project_id,
        entityType: 'project',
        entityId: job.project_id,
        actorUserId: job.requested_by_user_id,
        action: `project_file_cleanup_${nextStatus}`,
        changes: { jobId: job.id },
      })
    }
  })
  return true
}
