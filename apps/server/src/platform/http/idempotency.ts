import { createHash, randomUUID } from 'node:crypto'
import { and, eq, isNull } from 'drizzle-orm'
import type { Database } from '../database/client.js'
import { ApiError } from './errors.js'
import { ERROR_CODES } from './error-codes.js'
import { idempotencyRecord } from '../database/idempotency.tables.js'

type TransactionDatabase = Parameters<Parameters<Database['transaction']>[0]>[0]

function isUniqueConstraintError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  if ('code' in error && error.code === '23505') return true
  return 'cause' in error && isUniqueConstraintError(error.cause)
}

/** 计算请求体规范化哈希；调用方负责传入已校验输入。 */
export function requestHash(input: unknown): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex')
}

/**
 * 在业务事务内登记幂等键；唯一冲突转换为业务错误。
 * @param tx 业务事务。
 * @param input 操作者、团队、作用域、key、请求哈希与结果实体。
 * @returns 无返回值。
 * @throws key 已存在时抛出 IDEMPOTENCY_CONFLICT，并回滚业务事务。
 */
export async function recordIdempotency(
  tx: TransactionDatabase,
  input: {
    teamId: string | null
    actorUserId: string
    scope: string
    key: string
    hash: string
    responseEntityType: string
    responseEntityId: string
  },
): Promise<void> {
  try {
    await tx.insert(idempotencyRecord).values({
      id: randomUUID(),
      team_id: input.teamId,
      actor_user_id: input.actorUserId,
      scope: input.scope,
      idempotency_key: input.key,
      request_hash: input.hash,
      response_entity_type: input.responseEntityType,
      response_entity_id: input.responseEntityId,
      status_code: 200,
    })
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new ApiError(ERROR_CODES.IDEMPOTENCY_CONFLICT, '请求已处理，请刷新后查看结果')
    }
    throw error
  }
}

/**
 * 查询幂等键是否已被成功处理。
 * @param db 数据库连接。
 * @param input 团队、操作者、作用域与 key。
 * @returns 已存在时返回记录，否则 undefined。
 */
export async function findIdempotency(
  db: Database,
  input: {
    teamId: string | null
    actorUserId: string
    scope: string
    key: string
  },
) {
  const teamCondition =
    input.teamId === null ? isNull(idempotencyRecord.team_id) : eq(idempotencyRecord.team_id, input.teamId)
  const [row] = await db
    .select()
    .from(idempotencyRecord)
    .where(
      and(
        teamCondition,
        eq(idempotencyRecord.actor_user_id, input.actorUserId),
        eq(idempotencyRecord.scope, input.scope),
        eq(idempotencyRecord.idempotency_key, input.key),
      ),
    )
    .limit(1)
  return row
}
