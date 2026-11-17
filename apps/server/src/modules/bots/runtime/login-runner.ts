import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { containsCredential, type loginProvider, type LoginEvent, type LoginPrompt } from '@dev-ops/devops-bot'
import { and, asc, eq, gt, inArray, isNull, lte, sql } from 'drizzle-orm'
import { Type } from 'typebox'
import { Check } from 'typebox/value'
import type { Database } from '../../../platform/database/client.ts'
import { insertActivity } from '../../collaboration/collaboration.repository.ts'
import type { SecretCipher } from '../../configuration/configuration.crypto.ts'
import { teamMember } from '../../identity/identity.tables.ts'
import { botLoginSession, botModelConnection } from '../bots.tables.ts'

export type BotProviderLogin = typeof loginProvider
const liveStatuses = ['pending', 'waiting_user']
const secretEnvelope = Type.Object({
  ciphertext: Type.String(),
  iv: Type.String(),
  authTag: Type.String(),
  keyVersion: Type.Integer(),
})
const POLL_MS = 500

function safeMessage(value: string | undefined) {
  if (!value) return undefined
  return containsCredential(value) ? '请完成身份验证' : value.slice(0, 1_000)
}

function httpsUrl(value: string) {
  if (!URL.canParse(value)) return undefined
  const url = new URL(value)
  return url.protocol === 'https:' && !url.username && !url.password && value.length <= 4096 ? value : undefined
}

function promptUpdate(event: LoginEvent) {
  if (event.kind === 'device_code') {
    return { url: httpsUrl(event.url), userCode: safeMessage(event.userCode) }
  }
  if (event.kind === 'auth_url') return { url: httpsUrl(event.url), message: safeMessage(event.message) }
  return { message: safeMessage(event.message) }
}

function parseAnswer(cipher: SecretCipher, serialized: string) {
  try {
    const envelope: unknown = JSON.parse(serialized)
    if (!Check(secretEnvelope, envelope)) throw new Error('非法凭据格式')
    return cipher.decrypt(envelope)
  } catch {
    throw new Error('无法读取订阅授权输入')
  }
}

/**
 * 领取并完成一项订阅登录。进程异常退出后，未完成的交互到期并清理。
 * @param db 执行进程数据库。
 * @param owner 执行进程的标识。
 * @param login 共享库的提供方授权入口。
 * @param cipher 平台凭据加密器。
 * @param shutdown 执行进程的关闭信号。
 * @returns 是否领取过授权任务；存储异常向调用方传播。
 */
export async function runPendingBotLogin(
  db: Database,
  owner: string,
  login: BotProviderLogin,
  cipher: SecretCipher,
  shutdown: AbortSignal,
) {
  if (shutdown.aborted) return false
  const [expired] = await db
    .select({ id: botLoginSession.id })
    .from(botLoginSession)
    .where(and(inArray(botLoginSession.status, liveStatuses), lte(botLoginSession.expires_at, sql`clock_timestamp()`)))
    .orderBy(asc(botLoginSession.expires_at))
    .limit(1)
  if (expired) {
    await db
      .update(botLoginSession)
      .set({
        status: 'expired',
        prompt: null,
        answer_secret: null,
        lease_owner: null,
        lease_until: null,
        updated_at: sql`clock_timestamp()`,
      })
      .where(and(eq(botLoginSession.id, expired.id), inArray(botLoginSession.status, liveStatuses)))
  }
  const claimed = await db.transaction(async (tx) => {
    const [session] = await tx
      .select()
      .from(botLoginSession)
      .where(
        and(
          eq(botLoginSession.status, 'pending'),
          isNull(botLoginSession.lease_owner),
          gt(botLoginSession.expires_at, sql`clock_timestamp()`),
        ),
      )
      .orderBy(asc(botLoginSession.created_at), asc(botLoginSession.id))
      .limit(1)
      .for('update', { skipLocked: true })
    if (!session) return null
    const [connection] = await tx
      .select({
        providerId: botModelConnection.provider_id,
        userId: botModelConnection.login_user_id,
        version: botModelConnection.version,
      })
      .from(botModelConnection)
      .where(
        and(
          eq(botModelConnection.id, session.connection_id),
          eq(botModelConnection.team_id, session.team_id),
          eq(botModelConnection.auth_type, 'oauth'),
          eq(botModelConnection.status, 'login_failed'),
        ),
      )
    if (!connection?.userId) {
      await tx
        .update(botLoginSession)
        .set({ status: 'failed', updated_at: sql`clock_timestamp()` })
        .where(eq(botLoginSession.id, session.id))
      return null
    }
    await tx
      .update(botLoginSession)
      .set({
        lease_owner: owner,
        lease_until: session.expires_at,
        updated_at: sql`clock_timestamp()`,
      })
      .where(eq(botLoginSession.id, session.id))
    return { session, connection: { ...connection, userId: connection.userId } }
  })
  if (!claimed) return false
  const { session, connection } = claimed
  const interrupted = new AbortController()
  const signal = AbortSignal.any([
    shutdown,
    interrupted.signal,
    AbortSignal.timeout(Math.max(1, session.expires_at.getTime() - Date.now())),
  ])
  const scope = and(
    eq(botLoginSession.id, session.id),
    eq(botLoginSession.team_id, session.team_id),
    eq(botLoginSession.lease_owner, owner),
    inArray(botLoginSession.status, liveStatuses),
    gt(botLoginSession.expires_at, sql`clock_timestamp()`),
  )
  const stillActive = setInterval(() => {
    void db
      .select({ id: botLoginSession.id })
      .from(botLoginSession)
      .where(scope)
      .then(([row]) => {
        if (!row) interrupted.abort()
      })
      .catch(() => interrupted.abort())
  }, 2_000)
  let notifications = Promise.resolve()

  async function writePrompt(update: object) {
    const [saved] = await db
      .update(botLoginSession)
      .set({
        prompt: sql`coalesce(${botLoginSession.prompt}, '{}'::jsonb) || ${JSON.stringify(update)}::jsonb`,
        status: 'waiting_user',
        updated_at: sql`clock_timestamp()`,
      })
      .where(scope)
      .returning({ id: botLoginSession.id })
    if (!saved) interrupted.abort()
  }

  async function readAnswer(prompt: LoginPrompt, promptSignal: AbortSignal) {
    await writePrompt({
      question: {
        kind: prompt.kind,
        message: safeMessage(prompt.message) ?? '',
        placeholder: safeMessage(prompt.placeholder),
        options: prompt.options?.map((option) => ({
          id: option.id,
          label: safeMessage(option.label) ?? '',
          description: safeMessage(option.description),
        })),
      },
    })
    try {
      for (;;) {
        promptSignal.throwIfAborted()
        const result = await db.transaction(async (tx) => {
          const [row] = await tx
            .select({ answer: botLoginSession.answer_secret })
            .from(botLoginSession)
            .where(scope)
            .for('update')
          if (!row) throw new Error('订阅授权会话已结束')
          if (!row.answer) return null
          await tx
            .update(botLoginSession)
            .set({
              answer_secret: null,
              prompt: sql`${botLoginSession.prompt} - 'question'`,
              updated_at: sql`clock_timestamp()`,
            })
            .where(scope)
          return parseAnswer(cipher, row.answer)
        })
        if (result !== null) return result
        await delay(POLL_MS, undefined, { signal: promptSignal })
      }
    } finally {
      await db
        .update(botLoginSession)
        .set({
          answer_secret: null,
          prompt: sql`${botLoginSession.prompt} - 'question'`,
          updated_at: sql`clock_timestamp()`,
        })
        .where(scope)
    }
  }

  try {
    await login(
      connection.providerId,
      {
        signal,
        notify(event) {
          notifications = notifications.then(() => writePrompt(promptUpdate(event)))
          void notifications.catch(() => interrupted.abort())
        },
        answer: readAnswer,
      },
      {
        read: async () => undefined,
        list: async () => [],
        delete: async () => {
          throw new Error('订阅授权尚未保存')
        },
        async modify(providerId, update) {
          if (providerId !== connection.providerId) throw new Error('订阅提供方不匹配')
          const credential = await update(undefined)
          if (credential?.type !== 'oauth') throw new Error('授权没有返回订阅凭据')
          await notifications
          signal.throwIfAborted()
          await db.transaction(async (tx) => {
            const [member] = await tx
              .select({ id: teamMember.id })
              .from(teamMember)
              .where(
                and(
                  eq(teamMember.team_id, session.team_id),
                  eq(teamMember.user_id, connection.userId),
                  eq(teamMember.status, 'active'),
                  eq(teamMember.role, 'admin'),
                ),
              )
              .for('update')
            if (!member) throw new Error('发起者已失去管理员权限')
            const [saved] = await tx
              .update(botModelConnection)
              .set({
                oauth_secret: JSON.stringify(cipher.encrypt(JSON.stringify(credential))),
                status: 'active',
                disabled_reason: null,
                version: sql`${botModelConnection.version} + 1`,
                updated_at: sql`clock_timestamp()`,
              })
              .where(
                and(
                  eq(botModelConnection.id, session.connection_id),
                  eq(botModelConnection.team_id, session.team_id),
                  eq(botModelConnection.version, connection.version),
                  eq(botModelConnection.status, 'login_failed'),
                ),
              )
              .returning({ id: botModelConnection.id })
            if (!saved) throw new Error('订阅连接已变更')
            const [finalized] = await tx
              .update(botLoginSession)
              .set({
                status: 'succeeded',
                prompt: null,
                answer_secret: null,
                lease_owner: null,
                lease_until: null,
                updated_at: sql`clock_timestamp()`,
              })
              .where(scope)
              .returning({ id: botLoginSession.id })
            if (!finalized) throw new Error('订阅授权已结束')
            await insertActivity(tx, {
              id: randomUUID(),
              teamId: session.team_id,
              entityType: 'bot_model_connection',
              entityId: session.connection_id,
              projectId: null,
              actorUserId: connection.userId,
              action: 'bot_subscription_login_succeeded',
            })
          })
          return credential
        },
      },
    )
  } catch {
    await db
      .update(botLoginSession)
      .set({
        status: sql`case when ${botLoginSession.expires_at} <= clock_timestamp() then 'expired' else 'failed' end`,
        prompt: null,
        answer_secret: null,
        lease_owner: null,
        lease_until: null,
        updated_at: sql`clock_timestamp()`,
      })
      .where(
        and(
          eq(botLoginSession.id, session.id),
          eq(botLoginSession.lease_owner, owner),
          inArray(botLoginSession.status, liveStatuses),
        ),
      )
  } finally {
    clearInterval(stillActive)
  }
  return true
}
