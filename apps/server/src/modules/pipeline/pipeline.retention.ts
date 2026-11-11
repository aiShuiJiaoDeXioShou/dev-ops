import type { Database } from '../../platform/database/client.ts'
import type { PipelineStorage } from './pipeline.storage.ts'
import { findExpiredPipelineArtifacts, markPipelineArtifactsMissing } from './pipeline.repository.ts'

/** 产物清理依赖；Worker 周期调用，测试可直接注入。 */
export interface PipelineArtifactCleanupDeps {
  db: Database
  storage: PipelineStorage
  retentionDays: number
  log: (message: string, context?: Record<string, unknown>) => void
  /** 当前时间；测试可注入固定时间。 */
  now?: Date
}

/**
 * 清理超过保留期的流水线产物：删除文件并把元数据标记为 missing。
 * @param deps 数据库、存储、保留天数与日志。
 * @returns 本轮清理数量与失败数量。
 * @remarks 文件删除失败仍标记 missing，避免每轮重复扫描同一批文件；元数据保留用于审计。
 */
export async function cleanupExpiredPipelineArtifacts(
  deps: PipelineArtifactCleanupDeps,
): Promise<{ removed: number; failed: number }> {
  const cutoff = new Date((deps.now ?? new Date()).getTime() - deps.retentionDays * 86_400_000)
  const rows = await findExpiredPipelineArtifacts(deps.db, cutoff)
  if (rows.length === 0) return { removed: 0, failed: 0 }
  const removedIds: string[] = []
  let failed = 0
  for (const row of rows) {
    try {
      await deps.storage.removeArtifact(row.storage_key)
    } catch {
      failed += 1
    }
    removedIds.push(row.id)
  }
  await markPipelineArtifactsMissing(deps.db, removedIds)
  deps.log('流水线产物保留期清理完成', {
    removed: removedIds.length,
    fileDeleteFailed: failed,
    retentionDays: deps.retentionDays,
  })
  return { removed: removedIds.length, failed }
}
