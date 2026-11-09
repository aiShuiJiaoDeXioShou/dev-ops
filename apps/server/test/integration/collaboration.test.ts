import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { Client } from 'pg'
import { loadConfig } from '../../src/platform/config/env.js'
import { createDatabase } from '../../src/platform/database/client.js'
import { migrateDatabase } from '../../src/platform/database/migrate.js'
import { addComment, appendActivity, listActivities, listComments } from '../../src/modules/collaboration/public.js'
import { ApiError } from '../../src/platform/http/errors.js'

test('评论与活动在同一事务执行器中追加、分页并拒绝非法目标类型', { timeout: 60_000 }, async (t) => {
  const cleanup: Array<() => Promise<unknown>> = []
  t.after(async () => {
    const errors: unknown[] = []
    for (const dispose of cleanup.reverse()) {
      try {
        await dispose()
      } catch (error) {
        errors.push(error)
      }
    }
    if (errors.length > 0) throw new AggregateError(errors, '测试资源清理失败')
  })

  const runtimeValue = process.env.DATABASE_URL
  const migrationValue = process.env.MIGRATION_DATABASE_URL
  const adminPassword = process.env.POSTGRES_PASSWORD
  assert.ok(runtimeValue && migrationValue && adminPassword, '请先执行 db:setup 和 db:up')
  const runtimeUrl = new URL(runtimeValue)
  const migrationUrl = new URL(migrationValue)
  assert.equal(runtimeUrl.hostname, '127.0.0.1', '集成测试仅允许本机 Compose 数据库')
  assert.equal(migrationUrl.host, runtimeUrl.host)
  assert.equal(runtimeUrl.username, 'dev_ops_app')
  assert.equal(migrationUrl.username, 'dev_ops_migrator')

  const databaseName = `dev_ops_test_${randomBytes(8).toString('hex')}`
  const admin = new Client({
    host: runtimeUrl.hostname,
    port: Number(runtimeUrl.port || '5432'),
    user: 'postgres',
    password: adminPassword,
    database: 'postgres',
    connectionTimeoutMillis: 5_000,
  })
  await admin.connect()
  cleanup.push(async () => {
    await admin.end()
  })
  await admin.query(`CREATE DATABASE "${databaseName}" OWNER dev_ops_migrator`)
  cleanup.push(async () => {
    await admin.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`)
  })
  await admin.query(`REVOKE ALL ON DATABASE "${databaseName}" FROM PUBLIC`)
  await admin.query(`GRANT CONNECT ON DATABASE "${databaseName}" TO dev_ops_app`)
  runtimeUrl.pathname = `/${databaseName}`
  migrationUrl.pathname = `/${databaseName}`
  await migrateDatabase(migrationUrl.href)

  const config = loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: runtimeUrl.href,
    AUTH_SECRET: 'test-auth-secret-at-least-32-characters',
    APP_ORIGIN: 'http://localhost:5173',
    AUTH_TRUSTED_ORIGINS: 'http://localhost:5173',
  })
  const database = createDatabase(config, () => {})
  cleanup.push(async () => {
    await database.close()
  })

  const teamId = randomUUID()
  const projectId = randomUUID()
  const entityId = randomUUID()
  const actorUserId = randomUUID()

  const first = await database.db.transaction(async (tx) => {
    const comment = await addComment(tx, {
      teamId,
      projectId,
      entityType: 'requirement',
      entityId,
      authorUserId: actorUserId,
      bodyMarkdown: '**第一条**评论',
    })
    const activity = await appendActivity(tx, {
      teamId,
      projectId,
      entityType: 'requirement',
      entityId,
      action: 'status_changed',
      actorUserId,
      changes: { status: ['pending', 'in_development'] },
      reason: '开始开发',
    })
    return { comment, activity }
  })
  assert.equal(first.comment.bodyMarkdown, '**第一条**评论')
  assert.equal(first.activity.action, 'status_changed')

  await addComment(database.db, {
    teamId,
    projectId,
    entityType: 'requirement',
    entityId,
    authorUserId: actorUserId,
    bodyMarkdown: '第二条',
  })

  const comments = await listComments(database.db, 'requirement', entityId, 1, 20)
  assert.equal(comments.total, 2)
  assert.deepEqual(
    comments.items.map((item) => item.bodyMarkdown),
    ['**第一条**评论', '第二条'],
  )
  const activities = await listActivities(database.db, 'requirement', entityId, 1, 20)
  assert.equal(activities.total, 1)
  assert.deepEqual(activities.items[0]?.changes, { status: ['pending', 'in_development'] })

  await assert.rejects(
    addComment(database.db, { teamId, entityType: 'unknown', entityId, authorUserId: actorUserId, bodyMarkdown: 'x' }),
    (error: unknown) => error instanceof ApiError && error.code === 'VALIDATION_ERROR',
  )
})
