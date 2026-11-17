import { and, asc, desc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm'
import type { Database } from '../../platform/database/client.ts'
import { ERROR_CODES } from '../../platform/http/error-codes.ts'
import { ApiError } from '../../platform/http/errors.ts'
import { enqueueBotRun, requestBotRunStop, type BotRunTransaction } from '../bots/bots.run-queue.repository.ts'
import { requireRunnableBot } from '../bots/bots.service.ts'
import { botApiCall, botRun } from '../bots/bots.tables.ts'
import { redactChatContent } from '../bots/runtime/content.ts'
import { lockWritableBotConversation, requireBotConversation } from '../collaboration/bot-conversations.service.ts'
import { botConversationMember, botEvent } from '../collaboration/bot-conversations.tables.ts'
import type { SessionUser } from '../identity/identity.session.ts'
import { teamMember } from '../identity/identity.tables.ts'
import type { AppendBotTaskInput, CreateBotTaskInput, TaskTraceView } from './bot-tasks.schema.ts'
import { botTask, botTaskInput } from './bot-tasks.tables.ts'
import { botTaskView, taskRunView } from './bot-tasks.view.ts'

const TASK_PAGE_SIZE = 30
const RUN_TRACE_LIMIT = 100

type TaskRow = typeof botTask.$inferSelect
type ReadDb = Pick<Database, 'select'>

function taskMissing(): never {
  throw new ApiError(ERROR_CODES.NOT_FOUND, '任务不存在或不可见')
}

function stateConflict(message: string): never {
  throw new ApiError(ERROR_CODES.BOT_TASK_STATE_CONFLICT, message)
}

async function taskRowFor(db: ReadDb, taskId: string) {
  const [row] = await db.select().from(botTask).where(eq(botTask.id, taskId))
  if (!row) taskMissing()
  return row
}

function compareVersion(row: TaskRow, version: number) {
  if (row.version !== version) throw new ApiError(ERROR_CODES.VERSION_CONFLICT, '任务已更新，请刷新后重试')
}

async function taskInWritableConversation(tx: BotRunTransaction, actor: SessionUser, taskId: string) {
  const row = await taskRowFor(tx, taskId)
  const room = await lockWritableBotConversation(tx, actor, row.conversation_id)
  if (room.team_id !== row.team_id) taskMissing()
  return { row: await taskRowFor(tx, taskId), room }
}

async function activeTaskRuns(tx: BotRunTransaction, row: TaskRow) {
  return tx
    .select({ id: botRun.id })
    .from(botRun)
    .where(
      and(eq(botRun.team_id, row.team_id), eq(botRun.task_id, row.id), inArray(botRun.status, ['queued', 'running'])),
    )
    .orderBy(asc(botRun.id))
    .limit(20)
}

async function enqueueTask(tx: BotRunTransaction, row: TaskRow, actor: SessionUser) {
  const run = await enqueueBotRun(tx, {
    team_id: row.team_id,
    conversation_id: row.conversation_id,
    task_id: row.id,
    bot_id: row.executor_bot_id,
    trigger_user_id: actor.id,
    input_version: row.input_version,
  })
  return { task: botTaskView(row), runId: run.id, runStatus: 'queued' as const }
}

async function canExecute(tx: BotRunTransaction, teamId: string, botId: string) {
  try {
    await requireRunnableBot(tx, teamId, botId)
    return true
  } catch (error) {
    if (error instanceof ApiError && error.code === ERROR_CODES.BOT_UNAVAILABLE) return false
    throw error
  }
}

function safeString(payload: unknown, key: string): string | null {
  if (!payload || typeof payload !== 'object') return null
  const value: unknown = Reflect.get(payload, key)
  return typeof value === 'string' ? redactChatContent(value) : null
}

async function loadTaskTrace(db: Database, row: TaskRow, runIds: string[]): Promise<TaskTraceView[]> {
  if (runIds.length === 0) return []
  const [events, calls] = await Promise.all([
    db
      .select({ id: botEvent.id, runId: botEvent.run_id, payload: botEvent.payload, createdAt: botEvent.created_at })
      .from(botEvent)
      .where(
        and(
          eq(botEvent.team_id, row.team_id),
          eq(botEvent.conversation_id, row.conversation_id),
          inArray(botEvent.run_id, runIds),
          eq(botEvent.kind, 'tool_activity'),
        ),
      )
      .orderBy(desc(botEvent.sequence))
      .limit(RUN_TRACE_LIMIT),
    db
      .select({
        id: botApiCall.id,
        runId: botApiCall.run_id,
        kind: botApiCall.kind,
        state: botApiCall.status,
        summary: botApiCall.target,
        createdAt: botApiCall.created_at,
      })
      .from(botApiCall)
      .where(and(eq(botApiCall.team_id, row.team_id), inArray(botApiCall.run_id, runIds)))
      .orderBy(desc(botApiCall.created_at), desc(botApiCall.id))
      .limit(RUN_TRACE_LIMIT),
  ])
  return [
    ...events.map((event) => ({
      id: event.id,
      runId: event.runId,
      kind: 'tool',
      state: safeString(event.payload, 'state') ?? 'unknown',
      summary: safeString(event.payload, 'name'),
      createdAt: event.createdAt.toISOString(),
    })),
    ...calls.map((call) => ({
      ...call,
      summary: redactChatContent(call.summary),
      createdAt: call.createdAt.toISOString(),
    })),
  ].sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id))
}

/**
 * 组装会话任务、执行历史与停止接口。
 * @param db 平台业务数据库。
 * @returns 按当前会话成员校验，任务变更与调度状态在同一事务提交。
 */
export function createBotTasksService(db: Database) {
  return {
    /** 显式创建一项任务，私聊 Bot 或群组 Leader 可作为默认执行者。 */
    async create(actor: SessionUser, conversationId: string, input: CreateBotTaskInput) {
      const title = redactChatContent(input.title.trim())
      const criteria = redactChatContent(input.acceptanceCriteria.trim())
      if (!title || !criteria) throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '请输入目标和验收条件')
      return db.transaction(async (tx) => {
        const room = await lockWritableBotConversation(tx, actor, conversationId)
        const members = await tx
          .select({ id: botConversationMember.member_id, kind: botConversationMember.member_kind })
          .from(botConversationMember)
          .where(
            and(
              eq(botConversationMember.team_id, room.team_id),
              eq(botConversationMember.conversation_id, room.id),
              isNull(botConversationMember.removed_at),
            ),
          )
          .limit(200)
        const [businessOwner] = await tx
          .select({ id: teamMember.id })
          .from(teamMember)
          .where(
            and(
              eq(teamMember.team_id, room.team_id),
              eq(teamMember.user_id, input.businessOwnerId),
              eq(teamMember.status, 'active'),
            ),
          )
        if (!businessOwner || !members.some(({ id, kind }) => kind === 'user' && id === input.businessOwnerId))
          throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '业务负责人必须是会话中的有效成员')
        const executor =
          input.executorBotId ??
          (room.kind === 'group' ? room.leader_bot_id : members.find(({ kind }) => kind === 'bot')?.id)
        if (!executor || !members.some(({ id, kind }) => kind === 'bot' && id === executor))
          throw new ApiError(ERROR_CODES.BOT_NO_RECEIVER, '请选择当前会话中的智能体作为执行者')
        const runnable = await canExecute(tx, room.team_id, executor)
        const [row] = await tx
          .insert(botTask)
          .values({
            team_id: room.team_id,
            conversation_id: room.id,
            title,
            acceptance_criteria: criteria,
            business_owner_id: input.businessOwnerId,
            executor_bot_id: executor,
            created_by: actor.id,
            status: runnable ? 'pending' : 'waiting',
            blocked: !runnable,
            wait_reason: runnable ? null : 'executor_unavailable',
          })
          .returning()
        if (!row) throw new Error('未能创建 Bot 任务')
        await tx.insert(botTaskInput).values({
          team_id: row.team_id,
          task_id: row.id,
          input_version: row.input_version,
          content: redactChatContent(input.input?.trim() || title),
          created_by: actor.id,
        })
        if (!runnable) return { task: botTaskView(row), runId: null, runStatus: null }
        return enqueueTask(tx, row, actor)
      })
    },
    /** 按会话列出可见任务，游标必须属于该会话。 */
    async list(actor: SessionUser, conversationId: string, cursor?: string) {
      const room = await requireBotConversation(db, actor, conversationId)
      const previous = cursor ? await taskRowFor(db, cursor) : undefined
      if (previous && (previous.conversation_id !== room.id || previous.team_id !== room.team_id)) taskMissing()
      const rows = await db
        .select()
        .from(botTask)
        .where(
          and(
            eq(botTask.team_id, room.team_id),
            eq(botTask.conversation_id, room.id),
            previous
              ? or(
                  lt(botTask.created_at, previous.created_at),
                  and(eq(botTask.created_at, previous.created_at), lt(botTask.id, previous.id)),
                )
              : undefined,
          ),
        )
        .orderBy(desc(botTask.created_at), desc(botTask.id))
        .limit(TASK_PAGE_SIZE + 1)
      const items = rows.slice(0, TASK_PAGE_SIZE).map(botTaskView)
      return { items, nextCursor: rows.length > TASK_PAGE_SIZE ? (items.at(-1)?.id ?? null) : null }
    },
    /** 返回任务的不可变输入、最近运行及已脱敏的轨迹。 */
    async get(actor: SessionUser, taskId: string) {
      const row = await taskRowFor(db, taskId)
      const room = await requireBotConversation(db, actor, row.conversation_id)
      if (room.team_id !== row.team_id) taskMissing()
      const [inputs, runs] = await Promise.all([
        db
          .select()
          .from(botTaskInput)
          .where(and(eq(botTaskInput.team_id, row.team_id), eq(botTaskInput.task_id, row.id)))
          .orderBy(desc(botTaskInput.input_version))
          .limit(100),
        db
          .select()
          .from(botRun)
          .where(and(eq(botRun.team_id, row.team_id), eq(botRun.task_id, row.id)))
          .orderBy(desc(botRun.created_at), desc(botRun.id))
          .limit(50),
      ])
      return {
        ...botTaskView(row),
        inputs: inputs.map(({ id, input_version, content, created_by, created_at }) => ({
          id,
          inputVersion: input_version,
          content,
          createdBy: created_by,
          createdAt: created_at.toISOString(),
        })),
        runs: runs.map(taskRunView),
        trace: await loadTaskTrace(
          db,
          row,
          runs.map(({ id }) => id),
        ),
      }
    },
    /** 为未结束的任务追加一版要求；已领取的运行继续使用领取时的输入版本。 */
    async append(actor: SessionUser, taskId: string, input: AppendBotTaskInput) {
      const content = redactChatContent(input.content.trim())
      if (!content) throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '补充要求不能为空')
      return db.transaction(async (tx) => {
        const { row } = await taskInWritableConversation(tx, actor, taskId)
        compareVersion(row, input.version)
        if (row.status !== 'waiting') stateConflict('只可向等待中的任务补充要求')
        if ((await activeTaskRuns(tx, row)).length) stateConflict('任务已有排队或执行中的运行')
        const [updated] = await tx
          .update(botTask)
          .set({ input_version: row.input_version + 1, version: row.version + 1, updated_at: sql`clock_timestamp()` })
          .where(and(eq(botTask.id, row.id), eq(botTask.version, row.version), eq(botTask.status, 'waiting')))
          .returning()
        if (!updated) stateConflict('任务状态已变化，请刷新后重试')
        await tx.insert(botTaskInput).values({
          team_id: row.team_id,
          task_id: row.id,
          input_version: updated.input_version,
          content,
          created_by: actor.id,
        })
        return botTaskView(updated)
      })
    },
    /** 让等待中的任务使用当前输入版本进入队列，已有运行时拒绝重复入队。 */
    async rerun(actor: SessionUser, taskId: string, version: number) {
      return db.transaction(async (tx) => {
        const { row } = await taskInWritableConversation(tx, actor, taskId)
        compareVersion(row, version)
        if (row.status !== 'waiting') stateConflict('只可重新运行处于等待中的任务')
        if ((await activeTaskRuns(tx, row)).length) stateConflict('任务已有排队或执行中的运行')
        const [executor] = await tx
          .select({ id: botConversationMember.id })
          .from(botConversationMember)
          .where(
            and(
              eq(botConversationMember.team_id, row.team_id),
              eq(botConversationMember.conversation_id, row.conversation_id),
              eq(botConversationMember.member_kind, 'bot'),
              eq(botConversationMember.member_id, row.executor_bot_id),
              isNull(botConversationMember.removed_at),
            ),
          )
        if (!executor) stateConflict('执行者已离开会话，请先转交任务')
        await requireRunnableBot(tx, row.team_id, row.executor_bot_id)
        const [updated] = await tx
          .update(botTask)
          .set({
            status: 'pending',
            blocked: false,
            wait_reason: null,
            version: row.version + 1,
            updated_at: sql`clock_timestamp()`,
          })
          .where(and(eq(botTask.id, row.id), eq(botTask.version, version), eq(botTask.status, 'waiting')))
          .returning()
        if (!updated) stateConflict('任务状态已变化，请刷新后重试')
        return enqueueTask(tx, updated, actor)
      })
    },
    /** 取消任务并停止相关运行，已结束的任务保持原状态。 */
    async cancel(actor: SessionUser, taskId: string, version: number) {
      return db.transaction(async (tx) => {
        const { row } = await taskInWritableConversation(tx, actor, taskId)
        compareVersion(row, version)
        if (row.status === 'completed' || row.status === 'cancelled') stateConflict('任务已经结束')
        for (const run of await activeTaskRuns(tx, row)) await requestBotRunStop(tx, run.id, actor.id, false)
        const [updated] = await tx
          .update(botTask)
          .set({
            status: 'cancelled',
            blocked: false,
            wait_reason: null,
            version: row.version + 1,
            updated_at: sql`clock_timestamp()`,
          })
          .where(and(eq(botTask.id, row.id), eq(botTask.version, version)))
          .returning()
        if (!updated) stateConflict('任务状态已变化，请刷新后重试')
        return botTaskView(updated)
      })
    },
    /** 停止当前会话中排队或执行中的运行。 */
    async stop(actor: SessionUser, runId: string) {
      return db.transaction(async (tx) => {
        const [run] = await tx
          .select({ conversationId: botRun.conversation_id, teamId: botRun.team_id })
          .from(botRun)
          .where(eq(botRun.id, runId))
        if (!run) throw new ApiError(ERROR_CODES.NOT_FOUND, '运行不存在或不可见')
        const room = await lockWritableBotConversation(tx, actor, run.conversationId)
        if (room.team_id !== run.teamId) throw new ApiError(ERROR_CODES.NOT_FOUND, '运行不存在或不可见')
        const updated = await requestBotRunStop(tx, runId, actor.id)
        if (!updated) throw new ApiError(ERROR_CODES.BOT_RUN_STATE_CONFLICT, '运行已结束')
        return taskRunView(updated)
      })
    },
  }
}

export type BotTasksService = ReturnType<typeof createBotTasksService>
