import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import type { Database } from '../../platform/database/client.ts'
import { ERROR_CODES } from '../../platform/http/error-codes.ts'
import { ApiError } from '../../platform/http/errors.ts'
import { enqueueBotRun, lockBotRunLease, type BotRunLease } from '../bots/bots.run-queue.repository.ts'
import { hasChatCredential, redactChatContent } from '../bots/runtime/content.ts'
import { linkBotResultTags } from '../collaboration/work-tags.repository.ts'
import { lockWritableBotConversation } from '../collaboration/bot-conversations.service.ts'
import type { SessionUser } from '../identity/identity.session.ts'
import type { SubmitTaskResultInput, TaskResultView, TaskReviewView } from './bot-tasks.review.schema.ts'
import { botTask, botTaskInput, botTaskResult, botTaskReview } from './bot-tasks.tables.ts'
import { botTaskView } from './bot-tasks.view.ts'

type TaskRow = typeof botTask.$inferSelect
type Decision = TaskReviewView['decision']

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

function stateConflict(message: string): never {
  throw new ApiError(ERROR_CODES.BOT_TASK_STATE_CONFLICT, message)
}

/**
 * 在当前租约下保存一份不可变的任务结果。
 * @param db 执行服务数据库。
 * @param lease 本次运行的领取凭证。
 * @param input 正文、完成说明和验收证据，不允许包含凭据。
 * @returns 结果公开视图；运行不再有效或任务终态时拒绝。
 */
export async function submitBotTaskResult(db: Database, lease: BotRunLease, input: SubmitTaskResultInput) {
  const body = input.body.trim()
  const completionNote = input.completionNote.trim()
  const evidence = input.evidence.map((item) => item.trim())
  if (!body || !completionNote || evidence.some((item) => !item)) {
    throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '请填写结果、说明及有效证据')
  }
  if ([body, completionNote, ...evidence].some(hasChatCredential)) {
    throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '结果包含疑似凭据，请移除后重新提交')
  }
  return db.transaction(async (tx) => {
    const run = await lockBotRunLease(tx, lease)
    if (!run?.task_id || !run.conversation_id || run.stop_requested) stateConflict('运行已停止或不再具备提交资格')
    const scope = and(
      eq(botTask.id, run.task_id),
      eq(botTask.team_id, run.team_id),
      eq(botTask.conversation_id, run.conversation_id),
    )
    const [task] = await tx.select().from(botTask).where(scope).for('update')
    if (!task || task.executor_bot_id !== run.bot_id || task.input_version !== run.input_version || task.blocked) {
      stateConflict('任务当前执行者或输入已变化')
    }
    if (task.status === 'completed' || task.status === 'cancelled') stateConflict('任务已经结束')
    const [previous] = await tx
      .select()
      .from(botTaskResult)
      .where(
        and(
          eq(botTaskResult.team_id, task.team_id),
          eq(botTaskResult.task_id, task.id),
          eq(botTaskResult.run_id, run.id),
        ),
      )
    if (
      previous &&
      task.status === 'awaiting_review' &&
      previous.body === body &&
      previous.completion_note === completionNote &&
      JSON.stringify(previous.evidence) === JSON.stringify(evidence)
    )
      return resultView(previous)
    if (previous || (task.status !== 'in_progress' && task.status !== 'waiting')) {
      stateConflict('当前状态无法提交新结果')
    }
    const [saved] = await tx
      .insert(botTaskResult)
      .values({
        team_id: task.team_id,
        task_id: task.id,
        run_id: run.id,
        submitted_by_bot_id: run.bot_id,
        body,
        completion_note: completionNote,
        evidence,
      })
      .returning()
    if (!saved) throw new Error('未能保存 Bot 任务结果')
    if (!task.tagged_at) {
      await linkBotResultTags(tx, { teamId: task.team_id, taskId: task.id, botId: run.bot_id, tags: input.tags ?? [] })
    }
    const [updated] = await tx
      .update(botTask)
      .set({
        status: 'awaiting_review',
        tagged_at: task.tagged_at ?? sql`clock_timestamp()`,
        wait_reason: null,
        blocked: false,
        version: task.version + 1,
        updated_at: sql`clock_timestamp()`,
      })
      .where(and(scope, eq(botTask.version, task.version)))
      .returning({ id: botTask.id })
    if (!updated) stateConflict('任务状态已变化，请刷新后重试')
    return resultView(saved)
  })
}

/**
 * 对最新结果验收或退回，同时保存不可变评审历史。
 * @param db 平台数据库。
 * @param actor 当前发起评审的会话成员；路由要求人类登录会话。
 * @param taskId 待评审任务。
 * @param decision 验收或退回。
 * @param input 结果标识与意见；退回时填写原因。
 * @returns 更新后的任务与历史记录，退回时同时安排新一轮运行。
 */
export async function reviewBotTask(
  db: Database,
  actor: SessionUser,
  taskId: string,
  decision: Decision,
  input: { resultId: string; comment?: string },
) {
  const comment = redactChatContent(input.comment?.trim() ?? '') || null
  if (decision === 'changes_requested' && !comment) {
    throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '请填写退回原因')
  }
  return db.transaction(async (tx) => {
    const [locator] = await tx.select({ room: botTask.conversation_id }).from(botTask).where(eq(botTask.id, taskId))
    if (!locator) throw new ApiError(ERROR_CODES.NOT_FOUND, '任务不存在或不可见')
    const room = await lockWritableBotConversation(tx, actor, locator.room)
    const scope = and(eq(botTask.id, taskId), eq(botTask.team_id, room.team_id), eq(botTask.conversation_id, room.id))
    const [task] = await tx.select().from(botTask).where(scope).for('update')
    if (!task || task.status !== 'awaiting_review') stateConflict('任务已处理或尚未提交结果')
    const [result] = await tx
      .select({ id: botTaskResult.id })
      .from(botTaskResult)
      .where(and(eq(botTaskResult.task_id, taskId), eq(botTaskResult.team_id, room.team_id)))
      .orderBy(desc(botTaskResult.created_at), desc(botTaskResult.id))
      .limit(1)
    if (result?.id !== input.resultId) stateConflict('请选择当前待验收的结果')

    const [review] = await tx
      .insert(botTaskReview)
      .values({
        team_id: room.team_id,
        task_id: task.id,
        result_id: result.id,
        decision,
        comment,
        reviewer_user_id: actor.id,
      })
      .onConflictDoNothing({ target: botTaskReview.result_id })
      .returning()
    if (!review) stateConflict('该结果已经处理')
    const rework = decision === 'changes_requested'
    const [updated] = await tx
      .update(botTask)
      .set({
        status: rework ? 'in_progress' : 'completed',
        input_version: rework ? task.input_version + 1 : task.input_version,
        version: task.version + 1,
        updated_at: sql`clock_timestamp()`,
      })
      .where(and(scope, eq(botTask.version, task.version), eq(botTask.status, 'awaiting_review')))
      .returning()
    if (!updated) stateConflict('任务状态已变化，请刷新后重试')
    if (rework && comment) {
      // 退回使用新输入版本，旧运行随后结束时无法覆盖此次评审指派的任务状态。
      await tx.insert(botTaskInput).values({
        team_id: updated.team_id,
        task_id: updated.id,
        input_version: updated.input_version,
        created_by: actor.id,
        content: `退回原因：${comment}`,
      })
      await enqueueBotRun(tx, {
        team_id: updated.team_id,
        conversation_id: updated.conversation_id,
        task_id: updated.id,
        bot_id: updated.executor_bot_id,
        trigger_user_id: actor.id,
        input_version: updated.input_version,
      })
    }
    return { task: botTaskView(updated), review: reviewView(review) }
  })
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
