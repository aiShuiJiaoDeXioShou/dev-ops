import type { DatabaseExecutor } from '../collaboration/collaboration.repository.ts'
import { appendActivity } from '../collaboration/collaboration.service.ts'

/** 流水线审计动作；动作名稳定，便于检索与测试。 */
export type PipelineActivityAction =
  | 'pipeline_run_triggered'
  | 'pipeline_run_cancelled'
  | 'pipeline_run_completed'
  | 'pipeline_node_registered'
  | 'pipeline_node_drained'
  | 'pipeline_node_disabled'
  | 'pipeline_node_token_rotated'
  | 'pipeline_artifact_downloaded'

/**
 * 写入流水线活动记录。
 * @param db 数据库连接。
 * @param input 团队、项目、对象、动作与操作者。
 * @returns 活动写入完成后完成。
 */
export async function appendPipelineActivity(
  db: DatabaseExecutor,
  input: {
    teamId: string
    projectId?: string | null
    entityType: 'pipeline_run' | 'pipeline_node'
    entityId: string
    action: PipelineActivityAction
    actorUserId: string
    changes?: Record<string, unknown>
    reason?: string
  },
): Promise<void> {
  await appendActivity(db, {
    teamId: input.teamId,
    projectId: input.projectId ?? null,
    entityType: input.entityType,
    entityId: input.entityId,
    action: input.action,
    actorUserId: input.actorUserId,
    ...(input.changes ? { changes: input.changes } : {}),
    ...(input.reason ? { reason: input.reason } : {}),
  })
}
