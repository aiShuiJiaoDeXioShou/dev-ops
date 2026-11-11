import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { Client } from 'pg'
import { migrateDatabase } from '../../src/platform/database/migrate.ts'

const sourceDrizzle = fileURLToPath(new URL('../../drizzle', import.meta.url))

test('T014 从 V0.4a 迁移升级：已有运行获得默认 run_kind 并新增 V0.4b 表', { timeout: 120_000 }, async (t) => {
  const runtimeUrl = process.env.DATABASE_URL
  const migrationUrl = process.env.MIGRATION_DATABASE_URL
  const adminPassword = process.env.POSTGRES_PASSWORD
  assert.ok(runtimeUrl && migrationUrl && adminPassword, '需要本地数据库环境')
  const adminUrl = new URL(runtimeUrl)
  adminUrl.pathname = '/postgres'
  adminUrl.username = 'postgres'
  adminUrl.password = adminPassword
  const databaseName = `dev_ops_upgrade_${randomBytes(6).toString('hex')}`
  const admin = new Client({ connectionString: adminUrl.href, connectionTimeoutMillis: 5_000 })
  await admin.connect()
  const tempDir = await mkdtemp(join(tmpdir(), 'devops-upgrade-'))
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true })
    await admin.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`)
    await admin.end()
  })
  await admin.query(`CREATE DATABASE "${databaseName}" OWNER dev_ops_migrator`)
  await admin.query(`GRANT CONNECT ON DATABASE "${databaseName}" TO dev_ops_app`)

  // 只保留 0021 及以前的迁移，模拟 V0.4a 已部署库。
  const subset = join(tempDir, 'drizzle')
  await cp(sourceDrizzle, subset, { recursive: true })
  const journalPath = join(subset, 'meta', '_journal.json')
  const journal = JSON.parse(await readFile(journalPath, 'utf8')) as { entries: Array<{ tag: string }> }
  journal.entries = journal.entries.filter((entry) => entry.tag <= '0021')
  await writeFile(journalPath, JSON.stringify(journal, null, 2))
  const migration = new URL(migrationUrl)
  migration.pathname = `/${databaseName}`
  await migrateDatabase(migration.href, subset)

  const client = new Client({ connectionString: migration.href })
  await client.connect()
  try {
    const teamId = randomUUID()
    const runId = randomUUID()
    await client.query(
      `INSERT INTO app.pipeline_run (id, team_id, project_id, repository_id, workflow_path, git_ref, commit_sha, run_plan, workflow_snapshot, workflow_hash, status, trigger_source, initiator_channel, triggered_by_user_id, idempotency_key, timeout_seconds)
       VALUES ($1,$2,$3,$4,'.devops/workflows/ci.yml','main',$5,'{}'::jsonb,'name: ci','hash','succeeded','manual','web',$6,'upgrade-1',600)`,
      [runId, teamId, randomUUID(), randomUUID(), 'a'.repeat(40), randomUUID()],
    )
  } finally {
    await client.end()
  }

  await migrateDatabase(migration.href, sourceDrizzle)
  const verify = new Client({ connectionString: migration.href })
  await verify.connect()
  try {
    const run = await verify.query<{ run_kind: string; secret_environment: string }>(
      'SELECT run_kind, secret_environment FROM app.pipeline_run WHERE idempotency_key = $1',
      ['upgrade-1'],
    )
    assert.equal(run.rows[0]?.run_kind, 'workflow')
    assert.equal(run.rows[0]?.secret_environment, 'production')
    const table = await verify.query<{ exists: boolean }>(`SELECT to_regclass('app.change_plan') IS NOT NULL AS exists`)
    assert.equal(table.rows[0]?.exists, true)
  } finally {
    await verify.end()
  }
})
