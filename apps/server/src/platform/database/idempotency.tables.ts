import { index, integer, primaryKey, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core'
import { appSchema } from './namespace.ts'

/** 幂等请求记录；同一用户、范围与 key 只允许成功处理一次。 */
export const idempotencyRecord = appSchema.table(
  'idempotency_record',
  {
    id: uuid('id').notNull(),
    team_id: uuid('team_id'),
    actor_user_id: uuid('actor_user_id').notNull(),
    scope: text('scope').notNull(),
    idempotency_key: text('idempotency_key').notNull(),
    request_hash: text('request_hash').notNull(),
    response_entity_type: text('response_entity_type').notNull(),
    response_entity_id: uuid('response_entity_id'),
    status_code: integer('status_code').notNull(),
    created_at: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: 'pk_idempotency_record_id', columns: [table.id] }),
    unique('uk_idempotency_scope').on(table.team_id, table.actor_user_id, table.scope, table.idempotency_key),
    index('idx_idempotency_created_at').on(table.created_at),
  ],
)
