import { and, desc, eq, inArray } from 'drizzle-orm'
import type { Database } from '../../platform/database/client.ts'
import type { TaskResultView, TaskReviewView } from './bot-tasks.review.schema.ts'
import { botTask, botTaskResult, botTaskReview } from './bot-tasks.tables.ts'

type TaskRow = typeof botTask.$inferSelect

function resultView(row: typeof botTaskResult.$inferSelect): TaskResultView {
  if (!Array.isArray(row.evidence) || !row.evidence.every((item): item is string => typeof item === 'string')) {
    throw new Error('数据库中的任务证据格式不合法')
  }
  return {
    id: row.id,
    taskId: row.task_id,
    runId: row.run_id,
    body: row.body,
    completionNote: row.completion_note,
    evidence: row.evidence,
    submittedByBotId: row.submitted_by_bot_id,
    createdAt: row.created_at.toISOString(),
  }
}

function reviewView(row: typeof botTaskReview.$inferSelect): TaskReviewView {
  if (row.decision !== 'accepted' && row.decision !== 'changes_requested')
    throw new Error('数据库中的任务验收状态不合法')
  return {
    id: row.id,
    resultId: row.result_id,
    decision: row.decision,
    comment: row.comment,
    reviewerUserId: row.reviewer_user_id,
    createdAt: row.created_at.toISOString(),
  }
}

/**
 * 读取会话已授权任务的最近结果与对应评审。
 * @param db 平台数据库。
 * @param task 调用者已经检查会话权限的任务记录。
 * @returns 按时间倒序的结果和验收记录。
 */
export async function readTaskReviews(db: Database, task: TaskRow) {
  const results = await db
    .select()
    .from(botTaskResult)
    .where(and(eq(botTaskResult.team_id, task.team_id), eq(botTaskResult.task_id, task.id)))
    .orderBy(desc(botTaskResult.created_at), desc(botTaskResult.id))
    .limit(50)
  if (results.length === 0) return { results: [], reviews: [] }
  const reviews = await db
    .select()
    .from(botTaskReview)
    .where(
      and(
        eq(botTaskReview.team_id, task.team_id),
        eq(botTaskReview.task_id, task.id),
        inArray(
          botTaskReview.result_id,
          results.map(({ id }) => id),
        ),
      ),
    )
    .orderBy(desc(botTaskReview.created_at), desc(botTaskReview.id))
    .limit(50)
  return { results: results.map(resultView), reviews: reviews.map(reviewView) }
}
