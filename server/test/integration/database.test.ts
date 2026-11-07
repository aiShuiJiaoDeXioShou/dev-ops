import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { eq, sql } from 'drizzle-orm'
import { bigint, text } from 'drizzle-orm/pg-core'
import { Client } from 'pg'
import { buildApp } from '../../src/app.js'
import { loadConfig } from '../../src/config/env.js'
import { createDatabase } from '../../src/db/client.js'
import { migrateDatabase } from '../../src/db/migrate.js'
import { appSchema } from '../../src/db/schema.js'

// 此表仅在随机命名的测试库中创建，不写入业务 schema 或正式迁移。
const record = appSchema.table('integration_record', {
  id: bigint('id', { mode: 'bigint' }).generatedAlwaysAsIdentity().primaryKey(),
  key: text('key').notNull(),
})

test('PostgreSQL 真实迁移、权限、事务和后端生命周期', { timeout: 60_000 }, async (t) => {
  const cleanup: Array<() => Promise<unknown>> = []
  t.after(async () => {
    const errors: unknown[] = []
    for (const dispose of cleanup.reverse()) {
      try { await dispose() } catch (error) { errors.push(error) }
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
  assert.equal(migrationUrl.protocol, runtimeUrl.protocol)
  assert.equal(migrationUrl.host, runtimeUrl.host)
  assert.equal(runtimeUrl.username, 'dev_ops_app')
  assert.equal(migrationUrl.username, 'dev_ops_migrator')

  const databaseName = `dev_ops_test_${randomBytes(8).toString('hex')}`
  const admin = new Client({
    host: runtimeUrl.hostname,
    port: Number(runtimeUrl.port || '5432'),
    user: 'postgres', password: adminPassword, database: 'postgres',
    connectionTimeoutMillis: 5_000,
  })
  await admin.connect()
  cleanup.push(async () => { await admin.end() })
  // 数据库名只来自固定前缀及随机十六进制字符，不接收外部输入。
  await admin.query(`CREATE DATABASE "${databaseName}" OWNER dev_ops_migrator`)
  cleanup.push(async () => {
    await admin.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`)
  })
  await admin.query(`REVOKE ALL ON DATABASE "${databaseName}" FROM PUBLIC`)
  await admin.query(`GRANT CONNECT ON DATABASE "${databaseName}" TO dev_ops_app`)
  runtimeUrl.pathname = `/${databaseName}`
  migrationUrl.pathname = `/${databaseName}`

  const owner = new Client({ connectionString: migrationUrl.href, connectionTimeoutMillis: 5_000 })
  await owner.connect()
  cleanup.push(async () => { await owner.end() })
  const config = loadConfig({
    NODE_ENV: 'test', LOG_LEVEL: 'silent', DATABASE_URL: runtimeUrl.href,
    DB_STATEMENT_TIMEOUT_MS: '500', DB_LOCK_TIMEOUT_MS: '50',
  })
  const app = buildApp(config)
  cleanup.push(async () => { await app.close() })

  await t.test('空库就绪失败，迁移成功后返回 200，重复迁移不重复记录', async () => {
    assert.equal((await app.inject('/api/v1/ready')).statusCode, 503)
    assert.equal((await app.inject('/api/v1/health')).statusCode, 200)
    await migrateDatabase(migrationUrl.href)
    const before = await owner.query('SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations')
    assert.ok(before.rows[0].count > 0)
    await migrateDatabase(migrationUrl.href)
    const after = await owner.query('SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations')
    assert.equal(after.rows[0].count, before.rows[0].count)
    const response = await app.inject('/api/v1/ready')
    assert.equal(response.statusCode, 200)
    assert.deepEqual(response.json(), { status: 'ok', database: 'ok' })
  })

  await t.test('迁移后的已有数据可保留，后续表自动获得应用读写权限', async () => {
    await owner.query(`
      CREATE TABLE app.integration_record (
        id bigint GENERATED ALWAYS AS IDENTITY,
        key text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT pk_integration_record_id PRIMARY KEY (id),
        CONSTRAINT uk_integration_record_key UNIQUE (key)
      );
      COMMENT ON TABLE app.integration_record IS '仅用于隔离数据库集成测试';
      COMMENT ON COLUMN app.integration_record.id IS '记录主键';
      COMMENT ON COLUMN app.integration_record.key IS '唯一测试标识';
      COMMENT ON COLUMN app.integration_record.created_at IS '创建时间';
      COMMENT ON COLUMN app.integration_record.updated_at IS '更新时间';
    `)
    const [created] = await app.db.insert(record).values({ key: 'preserved' }).returning()
    assert.equal(typeof created?.id, 'bigint')
    await migrateDatabase(migrationUrl.href)
    assert.equal((await app.db.select().from(record).where(eq(record.key, 'preserved'))).length, 1)
    await app.db.update(record).set({ key: 'updated' }).where(eq(record.key, 'preserved'))
    assert.equal((await app.db.select().from(record).where(eq(record.key, 'updated'))).length, 1)
    await app.db.delete(record).where(eq(record.key, 'updated'))
  })

  await t.test('唯一约束由数据库保证，参数绑定不会将输入执行为 SQL', async () => {
    await app.db.insert(record).values({ key: 'unique' })
    await assert.rejects(app.db.insert(record).values({ key: 'unique' }))
    const input = "literal'); DROP TABLE app.integration_record; --"
    await app.db.insert(record).values({ key: input })
    assert.equal((await app.db.select().from(record).where(eq(record.key, input)))[0]?.key, input)
  })

  await t.test('新增迁移保留已有记录，失败迁移回滚结构且不留下成功记录', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'dev-ops-migration-test-'))
    try {
      await mkdir(join(folder, 'meta'))
      const history = await owner.query('SELECT max(created_at) AS latest FROM drizzle.__drizzle_migrations')
      const timestamp = Number(history.rows[0].latest) + 1
      await writeFile(join(folder, 'meta/_journal.json'), JSON.stringify({
        version: '7', dialect: 'postgresql', entries: [
          { idx: 0, version: '7', when: timestamp, tag: 'upgrade', breakpoints: true },
        ],
      }))
      await writeFile(join(folder, 'upgrade.sql'), 'ALTER TABLE app.integration_record ADD COLUMN description text;')
      await migrateDatabase(migrationUrl.href, folder)
      assert.equal((await app.db.select().from(record).where(eq(record.key, 'unique'))).length, 1)
      await app.db.execute(sql`UPDATE app.integration_record SET description = '升级成功' WHERE key = 'unique'`)

      // 失败用例使用独立的新迁移文件，不改写已执行迁移。
      await writeFile(join(folder, 'meta/_journal.json'), JSON.stringify({
        version: '7', dialect: 'postgresql', entries: [
          { idx: 0, version: '7', when: timestamp, tag: 'upgrade', breakpoints: true },
          { idx: 1, version: '7', when: timestamp + 1, tag: 'failure', breakpoints: true },
        ],
      }))
      await writeFile(join(folder, 'failure.sql'), 'ALTER TABLE app.integration_record ADD COLUMN rollback_probe text;\n--> statement-breakpoint\nSELECT 1 / 0;')
      await assert.rejects(migrateDatabase(migrationUrl.href, folder))
      const columns = await owner.query("SELECT column_name FROM information_schema.columns WHERE table_schema = 'app' AND table_name = 'integration_record' AND column_name = 'rollback_probe'")
      assert.equal(columns.rowCount, 0)
      const applied = await owner.query('SELECT max(created_at) AS latest FROM drizzle.__drizzle_migrations')
      assert.equal(Number(applied.rows[0].latest), timestamp)
    } finally {
      await rm(folder, { recursive: true, force: true })
    }
  })

  await t.test('事务失败回滚全部写入，连接仍可继续使用', async () => {
    await assert.rejects(app.db.transaction(async (tx) => {
      await tx.insert(record).values({ key: 'rollback' })
      throw new Error('模拟业务失败')
    }), /模拟业务失败/)
    assert.equal((await app.db.select().from(record).where(eq(record.key, 'rollback'))).length, 0)
    assert.equal((await app.inject('/api/v1/ready')).statusCode, 200)
  })

  await t.test('应用账号不能改结构或读取迁移记录，业务 schema 不存在外键', async () => {
    await assert.rejects(app.db.execute(sql`CREATE TABLE app.forbidden (id integer)`))
    await assert.rejects(app.db.execute(sql`DROP TABLE app.integration_record`))
    await assert.rejects(app.db.execute(sql`SELECT id FROM drizzle.__drizzle_migrations`))
    const result = await owner.query(`
      SELECT count(*)::int AS count FROM pg_constraint c
      JOIN pg_namespace n ON n.oid = c.connamespace
      WHERE n.nspname = 'app' AND c.contype = 'f'
    `)
    assert.equal(result.rows[0].count, 0)
  })

  await t.test('连接使用 UTC，语句与锁等待限制实际生效', async () => {
    const settings = await app.db.execute<{ timezone: string; statement: string; lock: string }>(sql`
      SELECT current_setting('TimeZone') AS timezone,
        current_setting('statement_timeout') AS statement,
        current_setting('lock_timeout') AS lock
    `)
    assert.deepEqual(settings.rows[0], { timezone: 'UTC', statement: '500ms', lock: '50ms' })
    await assert.rejects(app.db.execute(sql`SELECT pg_sleep(2)`))
    await owner.query('BEGIN')
    try {
      await owner.query('LOCK TABLE app.integration_record IN ACCESS EXCLUSIVE MODE')
      await assert.rejects(app.db.select().from(record))
    } finally {
      await owner.query('ROLLBACK')
    }
    assert.equal((await app.inject('/api/v1/ready')).statusCode, 200)
  })

  await t.test('并发迁移会被拒绝并释放自己的连接', async () => {
    await owner.query('SELECT pg_advisory_lock(164836, 1)')
    try {
      await assert.rejects(migrateDatabase(migrationUrl.href), /已有迁移正在执行/)
    } finally {
      await owner.query('SELECT pg_advisory_unlock(164836, 1)')
    }
    await migrateDatabase(migrationUrl.href)
  })

  await t.test('关闭应用会释放数据库连接池', async () => {
    await app.close()
    const result = await owner.query(`
      SELECT count(*)::int AS count FROM pg_stat_activity
      WHERE datname = current_database() AND application_name = 'dev-ops-api'
    `)
    assert.equal(result.rows[0].count, 0)
  })

  await t.test('空闲连接断开触发处理函数，连接池能重新建立连接', async () => {
    const errors: (string | undefined)[] = []
    const database = createDatabase(config, (code) => { errors.push(code) })
    try {
      const result = await database.db.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`)
      const pid = result.rows[0]?.pid
      assert.ok(pid)
      await admin.query('SELECT pg_terminate_backend($1)', [pid])
      for (let attempt = 0; attempt < 20 && errors.length === 0; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
      assert.ok(errors.length > 0)
      await database.check()
    } finally {
      await database.close()
    }
  })
})
