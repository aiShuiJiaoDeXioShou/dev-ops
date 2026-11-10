import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { and, desc, eq, isNull, lt, or } from 'drizzle-orm'
import type { Database } from '../../platform/database/client.ts'
import { ApiError } from '../../platform/http/errors.ts'
import { ERROR_CODES } from '../../platform/http/error-codes.ts'
import { authUser, personalAccessToken } from './identity.tables.ts'
import type { SessionUser } from './identity.session.ts'

const TOKEN_PREFIX = 'devops_pat_'
const DEFAULT_EXPIRY_DAYS = 90
const MAX_EXPIRY_DAYS = 365
const LAST_USED_UPDATE_INTERVAL_MS = 60_000

/** 对外返回的 API Token 元数据，不包含摘要或明文。 */
export interface TokenMetadata {
  id: string
  name: string
  tokenPrefix: string
  createdAt: string
  expiresAt: string
  lastUsedAt: string | null
  revokedAt: string | null
  status: 'active' | 'expired' | 'revoked'
}

/** 创建 Token 的输入。 */
export interface CreateTokenInput {
  name: string
  expiresInDays?: number
}

function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  if ('code' in error && error.code === '23505') return true
  return 'cause' in error && isUniqueViolation(error.cause)
}

/** 计算 Token 摘要，数据库只保存该值。 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function tokenStatus(row: typeof personalAccessToken.$inferSelect): TokenMetadata['status'] {
  if (row.revoked_at !== null) return 'revoked'
  if (row.expires_at.getTime() <= Date.now()) return 'expired'
  return 'active'
}

function toMetadata(row: typeof personalAccessToken.$inferSelect): TokenMetadata {
  return {
    id: row.id,
    name: row.name,
    tokenPrefix: row.token_prefix,
    createdAt: row.created_at.toISOString(),
    expiresAt: row.expires_at.toISOString(),
    lastUsedAt: row.last_used_at?.toISOString() ?? null,
    revokedAt: row.revoked_at?.toISOString() ?? null,
    status: tokenStatus(row),
  }
}

function normalizeName(name: string): string {
  const value = name.trim()
  if (value.length < 1 || value.length > 120) {
    throw new ApiError(ERROR_CODES.VALIDATION_ERROR, 'Token 名称长度必须在 1-120 个字符之间')
  }
  return value
}

function normalizeExpiryDays(value: number | undefined): number {
  const days = value ?? DEFAULT_EXPIRY_DAYS
  if (!Number.isSafeInteger(days) || days < 1 || days > MAX_EXPIRY_DAYS) {
    throw new ApiError(ERROR_CODES.VALIDATION_ERROR, `Token 有效期必须是 1-${MAX_EXPIRY_DAYS} 之间的整数天`)
  }
  return days
}

/**
 * 创建 API Token 用例：生成明文一次并返回，数据库只保存摘要。
 * @param input 名称与可选有效期天数。
 * @param userId 当前登录用户标识。
 * @returns 明文 Token 与元数据。
 * @throws 名称重复或输入非法时抛出业务错误。
 */
export function createTokenService({ db }: { db: Database }) {
  async function create(userId: string, input: CreateTokenInput) {
    const name = normalizeName(input.name)
    const expiresInDays = normalizeExpiryDays(input.expiresInDays)
    const token = `${TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`
    const id = randomUUID()
    const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)
    try {
      const [row] = await db
        .insert(personalAccessToken)
        .values({
          id,
          user_id: userId,
          name,
          token_hash: hashToken(token),
          token_prefix: token.slice(0, 16),
          expires_at: expiresAt,
        })
        .returning()
      if (!row) throw new Error('创建 API Token 后未返回记录')
      return { token, metadata: toMetadata(row) }
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ApiError(ERROR_CODES.TOKEN_NAME_DUPLICATE, '同账号已存在同名 API Token')
      }
      throw error
    }
  }

  async function list(userId: string): Promise<TokenMetadata[]> {
    const rows = await db
      .select()
      .from(personalAccessToken)
      .where(eq(personalAccessToken.user_id, userId))
      .orderBy(desc(personalAccessToken.created_at), desc(personalAccessToken.id))
    return rows.map(toMetadata)
  }

  async function revoke(userId: string, tokenId: string): Promise<TokenMetadata> {
    const [row] = await db
      .select()
      .from(personalAccessToken)
      .where(and(eq(personalAccessToken.id, tokenId), eq(personalAccessToken.user_id, userId)))
      .limit(1)
    if (!row) throw new ApiError(ERROR_CODES.TOKEN_NOT_FOUND, 'API Token 不存在')
    if (row.revoked_at !== null) return toMetadata(row)
    const [updated] = await db
      .update(personalAccessToken)
      .set({ revoked_at: new Date(), updated_at: new Date() })
      .where(eq(personalAccessToken.id, tokenId))
      .returning()
    if (!updated) throw new ApiError(ERROR_CODES.TOKEN_NOT_FOUND, 'API Token 不存在')
    return toMetadata(updated)
  }

  /**
   * 按 Bearer 明文校验 Token 并返回所属用户。
   * @param token 明文 Token。
   * @returns 用户与 Token 标识；Token 无效/过期/撤销时返回 null。
   */
  async function authenticate(token: string): Promise<{ user: SessionUser; tokenId: string } | null> {
    if (!token.startsWith(TOKEN_PREFIX)) return null
    const [row] = await db
      .select({ token: personalAccessToken, user: authUser })
      .from(personalAccessToken)
      .innerJoin(authUser, eq(authUser.id, personalAccessToken.user_id))
      .where(eq(personalAccessToken.token_hash, hashToken(token)))
      .limit(1)
    if (!row) return null
    if (row.token.revoked_at !== null || row.token.expires_at.getTime() <= Date.now()) return null
    const now = new Date()
    const threshold = new Date(now.getTime() - LAST_USED_UPDATE_INTERVAL_MS)
    const shouldUpdate = row.token.last_used_at === null || row.token.last_used_at.getTime() < threshold.getTime()
    if (shouldUpdate) {
      try {
        await db
          .update(personalAccessToken)
          .set({ last_used_at: now, updated_at: now })
          .where(
            and(
              eq(personalAccessToken.id, row.token.id),
              or(isNull(personalAccessToken.last_used_at), lt(personalAccessToken.last_used_at, threshold)),
            ),
          )
      } catch {
        // 最后使用时间是审计辅助信息，写入失败不得放宽鉴权或阻断请求。
      }
    }
    return {
      user: { id: row.user.id, email: row.user.email, name: row.user.name },
      tokenId: row.token.id,
    }
  }

  return { create, list, revoke, authenticate }
}

export type TokenService = ReturnType<typeof createTokenService>
