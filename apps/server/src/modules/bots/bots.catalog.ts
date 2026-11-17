import { and, asc, eq, lt, sql } from 'drizzle-orm'
import type { Database } from '../../platform/database/client.ts'
import { botModelCatalog } from './bots.tables.ts'

export type BotModelCatalogEntry = {
  providerId: string
  modelId: string
  displayName: string
  authTypes: readonly ('api_key' | 'oauth')[]
  contextWindow: number
}

/**
 * 在一次事务中替换执行进程报告的模型目录并清理已下线的模型。
 * @param db 执行进程数据库。
 * @param models 本次进程所支持的静态模型目录。
 * @returns 新目录全部可见后完成，失败则保留上次目录。
 */
export async function publishBotModelCatalog(db: Database, models: readonly BotModelCatalogEntry[]) {
  if (!models.length) throw new Error('执行进程没有可报告的对话模型')
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(164836, 3)`)
    const { rows } = await tx.execute<{ observed: string }>(sql`select clock_timestamp() as observed`)
    const observed = rows[0] ? new Date(rows[0].observed) : null
    if (!observed || !Number.isFinite(observed.getTime())) throw new Error('未能获取模型目录更新时间')
    for (let offset = 0; offset < models.length; offset += 250) {
      await tx
        .insert(botModelCatalog)
        .values(
          models.slice(offset, offset + 250).map((model) => ({
            provider_id: model.providerId,
            model_id: model.modelId,
            display_name: model.displayName,
            auth_types: [...model.authTypes],
            context_window: model.contextWindow,
            reported_at: observed,
          })),
        )
        .onConflictDoUpdate({
          target: [botModelCatalog.provider_id, botModelCatalog.model_id],
          set: {
            display_name: sql`excluded.display_name`,
            auth_types: sql`excluded.auth_types`,
            context_window: sql`excluded.context_window`,
            updated_at: observed,
            reported_at: observed,
          },
        })
    }
    await tx.delete(botModelCatalog).where(lt(botModelCatalog.reported_at, observed))
  })
}

/**
 * 用目录中的单条记录报告执行进程仍在线，避免周期性重写整个目录。
 * @param db 执行进程数据库。
 * @returns 写入完成；启动期没有目录时需要先发布。
 */
export async function heartbeatBotModelCatalog(db: Database) {
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(164836, 3)`)
    const [first] = await tx
      .select({ id: botModelCatalog.id })
      .from(botModelCatalog)
      .orderBy(asc(botModelCatalog.id))
      .limit(1)
    if (!first) return
    await tx
      .update(botModelCatalog)
      .set({
        reported_at: sql`clock_timestamp()`,
        updated_at: sql`clock_timestamp()`,
      })
      .where(eq(botModelCatalog.id, first.id))
  })
}

/**
 * 读取可选择的模型及支持的连接方式，支持按提供方筛选。
 * @param db 平台数据库连接，可传事务。
 * @param providerId 可选提供方标识。
 * @returns 目录列表；数据库中存在未知认证类型时拒绝。
 */
export async function listStoredBotModels(db: Pick<Database, 'select'>, providerId?: string) {
  const rows = await db
    .select({
      providerId: botModelCatalog.provider_id,
      modelId: botModelCatalog.model_id,
      displayName: botModelCatalog.display_name,
      authTypes: botModelCatalog.auth_types,
      contextWindow: botModelCatalog.context_window,
    })
    .from(botModelCatalog)
    .where(providerId ? eq(botModelCatalog.provider_id, providerId) : undefined)
    .orderBy(asc(botModelCatalog.provider_id), asc(botModelCatalog.display_name), asc(botModelCatalog.model_id))
    .limit(4_000)
  return rows.map(({ authTypes, ...row }) => ({
    ...row,
    authTypes: authTypes.map((kind) => {
      if (kind === 'api_key' || kind === 'oauth') return kind
      throw new Error('数据库中的模型认证类型不合法')
    }),
  }))
}

/**
 * 检查当前目录能否配置指定提供方和授权方法。
 * @param db 平台数据库或当前事务。
 * @param providerId 提供方标识。
 * @param kind 申请的认证类型。
 * @returns 至少一个模型接受该类型时为 true。
 */
export async function botCatalogSupports(db: Pick<Database, 'select'>, providerId: string, kind: 'api_key' | 'oauth') {
  const [row] = await db
    .select({ id: botModelCatalog.id })
    .from(botModelCatalog)
    .where(and(eq(botModelCatalog.provider_id, providerId), sql`${kind} = any(${botModelCatalog.auth_types})`))
    .limit(1)
  return row !== undefined
}
