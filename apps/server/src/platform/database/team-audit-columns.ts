import { timestamp, uuid } from 'drizzle-orm/pg-core'

/**
 * 为团队业务表定义主键列、归属列与审计时间列。
 * @returns 每次调用返回独立的列定义。更新业务记录时由写入方维护更新时间。
 */
export function teamAuditColumns() {
  return {
    id: uuid('id').defaultRandom().notNull(),
    team_id: uuid('team_id').notNull(),
    created_at: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  }
}
