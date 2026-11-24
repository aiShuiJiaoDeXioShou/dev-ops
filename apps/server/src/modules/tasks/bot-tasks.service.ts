import { and, desc, eq, inArray, lt, or } from 'drizzle-orm'
import type { Database } from '../../platform/database/client.ts'
import { ERROR_CODES } from '../../platform/http/error-codes.ts'
import { ApiError } from '../../platform/http/errors.ts'
import { requestBotRunStop } from '../bots/bots.run-queue.repository.ts'
import { redactChatContent } from '../bots/runtime/content.ts'
import { botApiCall, botRun } from '../bots/bots.tables.ts'
import { lockWritableBotConversation, requireBotConversation } from '../collaboration/bot-conversations.access.ts'
import { botEvent } from '../collaboration/bot-conversations.tables.ts'
import { readTargetWorkTags } from '../collaboration/work-tags.repository.ts'
import type { SessionUser } from '../identity/identity.session.ts'
import { readBotInbox } from './bot-inbox.read.ts'
import { readTaskReviews } from './bot-tasks.review.service.ts'
import type { TaskTraceView } from './bot-tasks.schema.ts'
import { botTask, botTaskHandoff, botTaskInput } from './bot-tasks.tables.ts'
import { botTaskView, taskRunView } from './bot-tasks.view.ts'

const TASK_PAGE_SIZE = 30
const RUN_TRACE_LIMIT = 100

type TaskRow = typeof botTask.$inferSelect
type ReadDb = Pick<Database, 'select'>

function taskMissing(): never {
  throw new ApiError(ERROR_CODES.NOT_FOUND, '任务不存在或不可见')
}

async function taskRowFor(db: ReadDb, taskId: string) {
  const [row] = await db.select().from(botTask).where(eq(botTask.id, taskId))
  if (!row) taskMissing()
  return row
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
 * @returns 按当前会话成员校验，旧任务仅可读，运行停止在事务中提交。
 */
export function createBotTasksService(db: Database) {
  return {
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
      const [inputs, runs, handoffs, tags] = await Promise.all([
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
        db
          .select()
          .from(botTaskHandoff)
          .where(and(eq(botTaskHandoff.team_id, row.team_id), eq(botTaskHandoff.task_id, row.id)))
          .orderBy(desc(botTaskHandoff.created_at), desc(botTaskHandoff.id))
          .limit(50),
        readTargetWorkTags(db, row.team_id, { targetKind: 'task', targetId: row.id }),
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
        tags,
        handoffs: handoffs.map((item) => ({
          id: item.id,
          fromBotId: item.from_bot_id,
          toBotId: item.to_bot_id,
          reason: item.reason,
          summary: item.summary,
          unfinished: item.unfinished,
          createdAt: item.created_at.toISOString(),
          createdBy: item.created_by,
        })),
        ...(await readTaskReviews(db, row)),
        trace: await loadTaskTrace(
          db,
          row,
          runs.map(({ id }) => id),
        ),
      }
    },
    /** 派生团队中当前成员可见的待处理任务。 */
    inbox(actor: SessionUser, teamId: string) {
      return readBotInbox(db, actor, teamId)
    },
    /** 停止当前会话中排队或执行中的运行。 */
    async stop(actor: SessionUser, runId: string) {
      return db.transaction(async (tx) => {
        const [run] = await tx
          .select({ conversationId: botRun.conversation_id, teamId: botRun.team_id })
          .from(botRun)
          .where(eq(botRun.id, runId))
        if (!run?.conversationId) throw new ApiError(ERROR_CODES.NOT_FOUND, '运行不存在或不可见')
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
