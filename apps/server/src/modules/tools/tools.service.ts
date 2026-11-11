import { createHash, randomUUID } from 'node:crypto'
import { and, desc, eq } from 'drizzle-orm'
import type { Database } from '../../platform/database/client.ts'
import { ApiError } from '../../platform/http/errors.ts'
import { ERROR_CODES } from '../../platform/http/error-codes.ts'
import type { ToolCapability, ToolChannel } from './tools.capabilities.ts'
import { toolInvocation } from './tools.tables.ts'

/** 调用记录状态；uncertain 表示外部结果未知，必须核对后才能收敛。 */
export type ToolInvocationStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'uncertain'

/** 创建一次写能力调用所需的输入。 */
export interface BeginInvocationInput {
  teamId: string
  projectId: string
  capability: ToolCapability
  channel: ToolChannel
  idempotencyKey: string
  requestFingerprint: string
  repositoryId?: string | null
  targetRef?: string | null
  inputSummary: Record<string, unknown>
  createdByUserId: string
}

/** 创建调用的结果；replayed 为 true 时表示命中既有幂等记录。 */
export interface BeginInvocationResult {
  invocationId: string
  replayed: boolean
  status: ToolInvocationStatus
}

/** 允许回写的调用完成字段。 */
export interface InvocationCompletion {
  status: Exclude<ToolInvocationStatus, 'queued' | 'running'>
  resultRef?: Record<string, unknown> | null
  errorCode?: string | null
  errorMessage?: string | null
}

/** 调用记录读模型。 */
export interface ToolInvocationRecordView {
  id: string
  capability: ToolCapability
  channel: ToolChannel
  status: ToolInvocationStatus
  repositoryId: string | null
  targetRef: string | null
  inputSummary: Record<string, unknown>
  resultRef: Record<string, unknown> | null
  errorCode: string | null
  errorMessage: string | null
  createdAt: string
  finishedAt: string | null
}

/**
 * 校验并返回幂等键。
 * @param value 请求头中的 Idempotency-Key。
 * @returns 去除首尾空白后的键。
 * @throws 缺失或长度不合法时抛出 IDEMPOTENCY_KEY_REQUIRED/VALIDATION_ERROR。
 */
export function requireIdempotencyKey(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ApiError(ERROR_CODES.IDEMPOTENCY_KEY_REQUIRED, '缺少 Idempotency-Key 请求头')
  }
  const key = value.trim()
  if (key.length > 200) throw new ApiError(ERROR_CODES.VALIDATION_ERROR, 'Idempotency-Key 不能超过 200 字符')
  return key
}

/**
 * 生成稳定的请求指纹：递归排序对象键，数组保持顺序，拒绝函数与 undefined。
 * @param payload 参与幂等判定的请求内容；不得包含未脱敏凭据。
 * @returns 64 位小写十六进制 SHA-256。
 */
export function buildRequestFingerprint(payload: unknown): string {
  return createHash('sha256').update(stableStringify(payload)).digest('hex')
}

/** 稳定序列化 JSON 值；键排序保证相同内容得到相同字符串。 */
function stableStringify(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '幂等指纹包含非有限数字')
    return JSON.stringify(value)
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`
  }
  throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '幂等指纹包含不支持的值')
}

/**
 * 创建或复用一次写能力调用。
 * @param db 数据库连接。
 * @param input 调用输入与幂等键；幂等键在项目内唯一。
 * @returns 调用标识与是否命中既有记录。
 * @throws 相同幂等键对应不同请求指纹时抛出 TOOL_INVOCATION_CONFLICT。
 * @remarks 插入与冲突查询分开执行，命中冲突后按指纹判定是否可复用。
 */
export async function beginInvocation(db: Database, input: BeginInvocationInput): Promise<BeginInvocationResult> {
  const id = randomUUID()
  const inserted = await db
    .insert(toolInvocation)
    .values({
      id,
      team_id: input.teamId,
      project_id: input.projectId,
      capability: input.capability,
      channel: input.channel,
      status: 'queued',
      idempotency_key: input.idempotencyKey,
      request_fingerprint: input.requestFingerprint,
      repository_id: input.repositoryId ?? null,
      target_ref: input.targetRef ?? null,
      input_summary: input.inputSummary,
      created_by_user_id: input.createdByUserId,
    })
    .onConflictDoNothing({ target: [toolInvocation.project_id, toolInvocation.idempotency_key] })
    .returning()
  const row = inserted[0]
  if (row) return { invocationId: row.id, replayed: false, status: 'queued' }

  const [existing] = await db
    .select()
    .from(toolInvocation)
    .where(
      and(eq(toolInvocation.project_id, input.projectId), eq(toolInvocation.idempotency_key, input.idempotencyKey)),
    )
    .limit(1)
  if (!existing) throw new Error('幂等调用记录冲突后读取失败')
  if (existing.request_fingerprint !== input.requestFingerprint) {
    throw new ApiError(ERROR_CODES.TOOL_INVOCATION_CONFLICT, '同一幂等键不能用于不同的写请求')
  }
  return {
    invocationId: existing.id,
    replayed: true,
    status: existing.status as ToolInvocationStatus,
  }
}

/**
 * 将调用推进为运行中；只有排队状态可推进。
 * @returns 是否成功推进；重复推进返回 false。
 */
export async function markInvocationRunning(db: Database, invocationId: string): Promise<boolean> {
  const now = new Date()
  const rows = await db
    .update(toolInvocation)
    .set({ status: 'running', started_at: now, updated_at: now })
    .where(and(eq(toolInvocation.id, invocationId), eq(toolInvocation.status, 'queued')))
    .returning({ id: toolInvocation.id })
  return rows.length > 0
}

/**
 * 写入调用结果；终态不可被再次覆盖。
 * @throws 调用不存在时抛出 NOT_FOUND。
 */
export async function completeInvocation(
  db: Database,
  invocationId: string,
  completion: InvocationCompletion,
): Promise<void> {
  const now = new Date()
  const rows = await db
    .update(toolInvocation)
    .set({
      status: completion.status,
      result_ref: completion.resultRef ?? null,
      error_code: completion.errorCode ?? null,
      error_message: completion.errorMessage ?? null,
      finished_at: now,
      updated_at: now,
    })
    .where(and(eq(toolInvocation.id, invocationId), eq(toolInvocation.status, 'running')))
    .returning({ id: toolInvocation.id })
  if (rows.length === 0) {
    const [existing] = await db
      .select({ id: toolInvocation.id })
      .from(toolInvocation)
      .where(eq(toolInvocation.id, invocationId))
      .limit(1)
    if (!existing) throw new ApiError(ERROR_CODES.NOT_FOUND, '调用记录不存在')
    throw new ApiError(ERROR_CODES.INVALID_TRANSITION, '调用已结束，不能再次写入结果')
  }
}

/**
 * 按标识读取调用记录视图。
 * @returns 调用记录；不存在时返回 undefined。
 */
export async function findInvocationView(
  db: Database,
  invocationId: string,
): Promise<ToolInvocationRecordView | undefined> {
  const [row] = await db.select().from(toolInvocation).where(eq(toolInvocation.id, invocationId)).limit(1)
  if (!row) return undefined
  return toInvocationView(row)
}

/** 列出项目调用记录，按创建时间倒序。 */
export async function listInvocationViews(
  db: Database,
  projectId: string,
  limit = 50,
): Promise<ToolInvocationRecordView[]> {
  const rows = await db
    .select()
    .from(toolInvocation)
    .where(eq(toolInvocation.project_id, projectId))
    .orderBy(desc(toolInvocation.created_at), toolInvocation.id)
    .limit(limit)
  return rows.map(toInvocationView)
}

function toInvocationView(row: typeof toolInvocation.$inferSelect): ToolInvocationRecordView {
  return {
    id: row.id,
    capability: row.capability as ToolCapability,
    channel: row.channel as ToolChannel,
    status: row.status as ToolInvocationStatus,
    repositoryId: row.repository_id,
    targetRef: row.target_ref,
    inputSummary: row.input_summary,
    resultRef: row.result_ref,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    createdAt: row.created_at.toISOString(),
    finishedAt: row.finished_at === null ? null : row.finished_at.toISOString(),
  }
}
