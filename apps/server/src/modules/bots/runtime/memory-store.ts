import {
  ESSENTIAL_MEMORY_BUDGET_BYTES,
  MAX_MEMORY_LENGTH,
  normalizeMemory,
  type MemoryDraft,
  type MemoryEntry,
  type MemoryPatch,
  type MemoryStore,
} from '@dev-ops/devops-bot'
import { and, asc, count, desc, eq, ilike, ne, or, sql, type SQL } from 'drizzle-orm'
import type { Database } from '../../../platform/database/client.ts'
import { isUniqueViolation } from '../../../platform/database/errors.ts'
import { ERROR_CODES } from '../../../platform/http/error-codes.ts'
import { ApiError } from '../../../platform/http/errors.ts'
import {
  lockBotRunLease,
  type BotRunLease,
  type ConversationBotRunRecord,
  type BotRunTransaction,
} from '../bots.run-queue.repository.ts'
import { botMemory } from '../bots.tables.ts'
import { hasChatCredential } from './content.ts'

const USER_LIMIT = 100
const BOT_LIMIT = 200
type ReadDb = Pick<Database, 'select'>
export type MemoryRow = typeof botMemory.$inferSelect
export type MemoryScope = { teamId: string; botId: string; userId: string }

function missing(): never {
  throw new ApiError(ERROR_CODES.NOT_FOUND, '记忆不存在或不可见')
}

function limitExceeded(): never {
  throw new ApiError(ERROR_CODES.BOT_MEMORY_LIMIT, '记忆已达到容量上限，请先整理已有条目')
}

function checkedContent(value: string) {
  const content = value.trim()
  if (!content || [...content].length > MAX_MEMORY_LENGTH) {
    throw new ApiError(ERROR_CODES.VALIDATION_ERROR, `记忆须为 1 至 ${MAX_MEMORY_LENGTH} 个字符`)
  }
  if (hasChatCredential(content)) throw new ApiError(ERROR_CODES.BOT_MEMORY_SECRET, '请移除记忆中的疑似凭据')
  return content
}

function knownScope(row: MemoryRow): MemoryDraft['scope'] {
  if (row.scope !== 'bot' && row.scope !== 'user') throw new Error('数据库中的记忆范围不合法')
  return row.scope
}

function toMemoryEntry(row: MemoryRow): MemoryEntry {
  return { id: row.id, scope: knownScope(row), content: row.content, essential: row.essential }
}

function visible(scope: MemoryScope) {
  return and(
    eq(botMemory.team_id, scope.teamId),
    eq(botMemory.bot_id, scope.botId),
    or(eq(botMemory.scope, 'bot'), and(eq(botMemory.scope, 'user'), eq(botMemory.user_id, scope.userId))),
  )
}

function target(scope: MemoryScope, kind: MemoryDraft['scope']) {
  return and(
    eq(botMemory.team_id, scope.teamId),
    eq(botMemory.bot_id, scope.botId),
    eq(botMemory.scope, kind),
    kind === 'user' ? eq(botMemory.user_id, scope.userId) : undefined,
  )
}

/** 按团队与 Bot 串行维护记忆条数和常驻字节预算。 */
export async function lockMemoryScope(tx: BotRunTransaction, scope: Pick<MemoryScope, 'teamId' | 'botId'>) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`bot-memory:${scope.teamId}:${scope.botId}`}, 0))`,
  )
}

async function assertBudget(tx: BotRunTransaction, scope: MemoryScope, entry: MemoryDraft, replacing?: string) {
  if (!entry.essential) return
  const bytes = sql`sum(octet_length(to_json(${botMemory.content})::text) + 3)`
  const groups = tx
    .select({ kind: botMemory.scope, size: sql<number>`${bytes}`.mapWith(Number).as('size') })
    .from(botMemory)
    .where(
      and(
        eq(botMemory.team_id, scope.teamId),
        eq(botMemory.bot_id, scope.botId),
        eq(botMemory.essential, true),
        replacing ? ne(botMemory.id, replacing) : undefined,
        entry.scope === 'user' ? or(eq(botMemory.scope, 'bot'), eq(botMemory.user_id, scope.userId)) : undefined,
      ),
    )
    .groupBy(botMemory.scope, botMemory.user_id)
    .as('memory_budget')
  const totals = await tx
    .select({ kind: groups.kind, maximum: sql<number>`max(${groups.size})`.mapWith(Number) })
    .from(groups)
    .groupBy(groups.kind)
  const used = totals.reduce((sum, row) => sum + row.maximum, 0)
  if (used + Buffer.byteLength(`- ${JSON.stringify(entry.content)}\n`) > ESSENTIAL_MEMORY_BUDGET_BYTES) limitExceeded()
}

/** 复用规范化后相同的条目，或在容量允许时保存带有来源的新条目。 */
export async function addScopedMemory(
  tx: BotRunTransaction,
  scope: MemoryScope,
  entry: MemoryDraft,
  source: { userId: string; conversationId?: string; kind: 'user' | 'bot' },
) {
  const content = checkedContent(entry.content)
  const normalized = normalizeMemory(content)
  const within = target(scope, entry.scope)
  const [previous] = await tx
    .select()
    .from(botMemory)
    .where(and(within, eq(botMemory.normalized_content, normalized)))
  if (previous) return previous
  const [total] = await tx.select({ amount: count() }).from(botMemory).where(within)
  if ((total?.amount ?? 0) >= (entry.scope === 'bot' ? BOT_LIMIT : USER_LIMIT)) limitExceeded()
  await assertBudget(tx, scope, { ...entry, content })
  const [saved] = await tx
    .insert(botMemory)
    .values({
      team_id: scope.teamId,
      bot_id: scope.botId,
      scope: entry.scope,
      user_id: entry.scope === 'user' ? scope.userId : null,
      content,
      normalized_content: normalized,
      essential: entry.essential,
      source_user_id: source.userId,
      source_conversation_id: source.conversationId,
      updated_by_kind: source.kind,
    })
    .returning()
  if (!saved) throw new Error('未能保存 Bot 记忆')
  return saved
}

/** 更新可写记忆中明确提供的字段，保留原始来源和归属。 */
export async function patchScopedMemory(
  tx: BotRunTransaction,
  row: MemoryRow,
  change: MemoryPatch,
  kind: 'bot' | 'user',
) {
  if (change.content === undefined && change.essential === undefined) {
    throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '请提供需要修改的记忆字段')
  }
  const content = change.content === undefined ? row.content : checkedContent(change.content)
  const essential = change.essential ?? row.essential
  const scope = { teamId: row.team_id, botId: row.bot_id, userId: row.user_id ?? row.source_user_id }
  await assertBudget(tx, scope, { scope: knownScope(row), content, essential }, row.id)
  try {
    const [updated] = await tx
      .update(botMemory)
      .set({
        content,
        essential,
        normalized_content: normalizeMemory(content),
        updated_by_kind: kind,
        updated_at: sql`clock_timestamp()`,
      })
      .where(and(eq(botMemory.id, row.id), eq(botMemory.team_id, row.team_id)))
      .returning()
    if (!updated) missing()
    return updated
  } catch (error) {
    if (isUniqueViolation(error)) throw new ApiError(ERROR_CODES.VERSION_CONFLICT, '该范围已存在相同内容的记忆')
    throw error
  }
}

/** 读取当前执行范围内的常驻记忆，供模型按同一格式应用字节预算。 */
export async function readEssentialMemories(db: ReadDb, scope: MemoryScope): Promise<MemoryEntry[]> {
  const rows = await db
    .select()
    .from(botMemory)
    .where(and(visible(scope), eq(botMemory.essential, true)))
    .orderBy(desc(botMemory.updated_at), desc(botMemory.id))
    .limit(USER_LIMIT + BOT_LIMIT)
  return rows.map(toMemoryEntry)
}

/** 生成中文关键词匹配条件，结合子串与 PostgreSQL trigram。 */
export function memorySearchCondition(query?: string): { filter?: SQL; relevance?: SQL } {
  const search = normalizeMemory(query ?? '').slice(0, 200)
  if (!search) return {}
  const escaped = search.replace(/[\\%_]/gu, '\\$&')
  return {
    filter: or(
      ilike(botMemory.normalized_content, `%${escaped}%`),
      search.length >= 3 ? sql`${search} <% ${botMemory.normalized_content}` : undefined,
    ),
    relevance: sql`case when ${botMemory.normalized_content} ilike ${`%${escaped}%`} then 1 else 0 end desc, word_similarity(${search}, ${botMemory.normalized_content}) desc`,
  }
}

/** 装配本轮的 PostgreSQL 记忆端口；旧租约无法读写当前用户的记忆。 */
export function createPgMemoryStore(db: Database, run: ConversationBotRunRecord, lease: BotRunLease): MemoryStore {
  const scope = { teamId: run.team_id, botId: run.bot_id, userId: run.trigger_user_id }
  async function withLease<Result>(action: (tx: BotRunTransaction) => Promise<Result>, write: boolean) {
    return db.transaction(async (tx) => {
      const claimed = await lockBotRunLease(tx, lease)
      if (
        !claimed ||
        claimed.stop_requested ||
        claimed.team_id !== scope.teamId ||
        claimed.bot_id !== scope.botId ||
        claimed.trigger_user_id !== scope.userId ||
        claimed.conversation_id !== run.conversation_id
      )
        missing()
      if (write) await lockMemoryScope(tx, scope)
      return action(tx)
    })
  }
  async function find(tx: BotRunTransaction, id: string) {
    if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(id)) missing()
    const [row] = await tx
      .select()
      .from(botMemory)
      .where(and(visible(scope), eq(botMemory.id, id)))
    if (!row) missing()
    return row
  }
  return {
    /** 按相关性返回受限范围内匹配的记忆。 */
    search(query, limit) {
      return withLease(async (tx) => {
        const match = memorySearchCondition(query)
        const rows = await tx
          .select()
          .from(botMemory)
          .where(and(visible(scope), match.filter))
          .orderBy(...(match.relevance ? [match.relevance] : []), desc(botMemory.updated_at), asc(botMemory.id))
          .limit(Math.min(50, Math.max(0, Math.floor(limit))))
        return rows.map(toMemoryEntry)
      }, false)
    },
    /** 保存来源为当前会话与触发人的记忆。 */
    add(entry) {
      return withLease(
        async (tx) =>
          toMemoryEntry(
            await addScopedMemory(tx, scope, entry, {
              userId: scope.userId,
              conversationId: run.conversation_id,
              kind: 'bot',
            }),
          ),
        true,
      )
    },
    /** 只修改当前执行范围内的条目。 */
    patch(id, change) {
      return withLease(
        async (tx) => toMemoryEntry(await patchScopedMemory(tx, await find(tx, id), change, 'bot')),
        true,
      )
    },
    /** 删除当前执行范围内的条目。 */
    remove(id) {
      return withLease(async (tx) => {
        const row = await find(tx, id)
        await tx.delete(botMemory).where(and(eq(botMemory.id, row.id), visible(scope)))
      }, true)
    },
  }
}
