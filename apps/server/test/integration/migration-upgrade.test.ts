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

test('从 V0.4a 迁移升级：保留流水线、版本历史和模型凭据并删除旧运维数据', { timeout: 120_000 }, async (t) => {
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
  const writeJournal = (entries: typeof journal.entries) =>
    writeFile(journalPath, JSON.stringify({ ...journal, entries }))
  await writeJournal(journal.entries.filter((entry) => entry.tag <= '0021'))
  const migration = new URL(migrationUrl)
  migration.pathname = `/${databaseName}`
  await migrateDatabase(migration.href, subset)

  const client = new Client({ connectionString: migration.href })
  await client.connect()
  const teamId = randomUUID()
  const projectId = randomUUID()
  const actorId = randomUUID()
  const legacyConnectionId = randomUUID()
  const appConnectionId = randomUUID()
  const legacyRepositoryId = randomUUID()
  const appRepositoryId = randomUUID()
  const runId = randomUUID()
  const modelKeyId = randomUUID()
  try {
    await client.query(
      'INSERT INTO app.project (id, team_id, name, owner_user_id, created_by_user_id) VALUES ($1, $2, $3, $4, $4)',
      [projectId, teamId, '升级前创建的项目', actorId],
    )
    await client.query(
      `INSERT INTO app.pipeline_run (id, team_id, project_id, repository_id, workflow_path, git_ref, commit_sha, run_plan, workflow_snapshot, workflow_hash, status, trigger_source, initiator_channel, triggered_by_user_id, idempotency_key, timeout_seconds)
       VALUES ($1,$2,$3,$4,'.devops/workflows/ci.yml','main',$5,'{}'::jsonb,'name: ci','hash','succeeded','manual','web',$6,'upgrade-1',600)`,
      [runId, teamId, projectId, legacyRepositoryId, 'a'.repeat(40), actorId],
    )
    await client.query(
      `INSERT INTO app.git_connection (id, team_id, provider_key, instance_url, name, auth_kind, external_identity, created_by_user_id)
       VALUES ($1, $3, 'github', 'https://github.com', '旧连接', 'github_cli', 'test', $4),
              ($2, $3, 'github', 'https://github.com', 'App 连接', 'github_app_installation', '1', $4)`,
      [legacyConnectionId, appConnectionId, teamId, actorId],
    )
    await client.query(
      `INSERT INTO app.git_repository (id, team_id, connection_id, provider_key, remote_repository_id, namespace, name, web_url)
       VALUES ($1, $5, $3, 'github', '1', 'example', 'legacy', 'https://github.com/example/legacy'),
              ($2, $5, $4, 'github', '2', 'example', 'current', 'https://github.com/example/current')`,
      [legacyRepositoryId, appRepositoryId, legacyConnectionId, appConnectionId, teamId],
    )
    await client.query(
      `INSERT INTO app.project_repository (id, team_id, project_id, repository_id, created_by_user_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [randomUUID(), teamId, projectId, legacyRepositoryId, actorId],
    )
  } finally {
    await client.end()
  }

  const retirement = journal.entries.findIndex((entry) => entry.tag.endsWith('_remove_operations'))
  assert.ok(retirement > 0, '必须先应用旧运维模块的迁移')
  await writeJournal(journal.entries.slice(0, retirement))
  await migrateDatabase(migration.href, subset)
  await seedBeforeOperationsRetirement(migration.href, { teamId, projectId, actorId, runId, modelKeyId })

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
    const modelKey = await verify.query<{ kind: string }>('SELECT kind FROM app.credential WHERE id = $1', [modelKeyId])
    assert.equal(modelKey.rows[0]?.kind, 'model_api_key')
    for (const table of ['change_plan', 'change_plan_approval', 'change_execution', 'change_plan_event']) {
      const result = await verify.query<{ table: string | null }>('SELECT to_regclass($1) AS table', [`app.${table}`])
      assert.equal(result.rows[0]?.table, null, `应删除 ${table}`)
    }
    const versions = await verify.query<{
      version_label: string
      source: string
      evidence_url: string | null
      confirmed_at: Date
    }>(
      'SELECT version_label, source, evidence_url, confirmed_at FROM app.service_run_version WHERE project_id = $1 ORDER BY version_label',
      [projectId],
    )
    assert.deepEqual(versions.rows, [
      { version_label: 'v1.0.0', source: 'deployment_receipt', evidence_url: null, confirmed_at: confirmedAt },
      { version_label: 'v2.0.0', source: 'manual', evidence_url: externalEvidenceUrl, confirmed_at: confirmedAt },
    ])
    const history = await verify.query<{ new_version_label: string; source: string; evidence_url: string | null }>(
      'SELECT new_version_label, source, evidence_url FROM app.service_run_version_change WHERE project_id = $1 ORDER BY new_version_label',
      [projectId],
    )
    assert.deepEqual(history.rows, [
      { new_version_label: 'v1.0.0', source: 'deployment_receipt', evidence_url: null },
      { new_version_label: 'v2.0.0', source: 'manual', evidence_url: externalEvidenceUrl },
    ])
    const connections = await verify.query<{ auth_kind: string; status: string; repository_status: string }>(
      `SELECT connection.auth_kind, connection.status, repository.status AS repository_status
       FROM app.git_connection AS connection
       JOIN app.git_repository AS repository ON repository.connection_id = connection.id
       WHERE connection.team_id = $1 ORDER BY connection.auth_kind`,
      [teamId],
    )
    assert.deepEqual(connections.rows, [
      { auth_kind: 'github_app_installation', status: 'active', repository_status: 'available' },
      { auth_kind: 'github_cli', status: 'revoked', repository_status: 'removed' },
    ])
    const projectLink = await verify.query<{ repository_id: string }>(
      'SELECT repository_id FROM app.project_repository WHERE project_id = $1',
      [projectId],
    )
    assert.equal(projectLink.rows[0]?.repository_id, legacyRepositoryId)
    const templates = await verify.query<{ work_item_templates: unknown }>(
      'SELECT work_item_templates FROM app.project WHERE id = $1',
      [projectId],
    )
    assert.deepEqual(templates.rows[0]?.work_item_templates, {})
  } finally {
    await verify.end()
  }
})

const confirmedAt = new Date('2026-11-11T00:00:00.000Z')
const externalEvidenceUrl = 'https://deploy.example.test/runs/42'

async function seedBeforeOperationsRetirement(
  connectionString: string,
  ids: { teamId: string; projectId: string; actorId: string; runId: string; modelKeyId: string },
) {
  const { teamId, projectId, actorId, runId, modelKeyId } = ids
  const client = new Client({ connectionString })
  await client.connect()
  try {
    await client.query(
      `INSERT INTO app.credential (id, team_id, name, kind, created_by_user_id)
       VALUES ($1, $2, '模型凭据', 'model_api_key', $3)`,
      [modelKeyId, teamId, actorId],
    )
    const serviceId = randomUUID()
    const planId = randomUUID()
    const executionId = randomUUID()
    const planUrl = `https://devops.example.test/operations/changes/${planId}`
    await client.query(
      `INSERT INTO app.change_plan
         (id, team_id, project_id, service_id, target_resource, environment, operation_kind, status, version_label,
          scope_summary, evidence, rollback_plan, execution_mode, workflow_path, created_by_user_id)
       VALUES ($1, $2, $3, $4, 'web', 'test', 'deploy_version', 'completed', 'v1.0.0',
               '部署测试服务', '流水线执行完成', '回退旧版本', 'platform_pipeline', 'deploy.yml', $5)`,
      [planId, teamId, projectId, serviceId, actorId],
    )
    await client.query(
      `INSERT INTO app.change_plan_approval
         (id, team_id, project_id, plan_id, plan_revision, plan_snapshot, approved_by_user_id, approved_at)
       VALUES ($1, $2, $3, $4, 1, '{}'::jsonb, $5, $6)`,
      [randomUUID(), teamId, projectId, planId, actorId, confirmedAt],
    )
    await client.query(
      `INSERT INTO app.change_execution
         (id, team_id, project_id, plan_id, plan_revision, attempt, execution_mode, status, pipeline_run_id,
          verification_status, expected_version_label, created_by_user_id)
       VALUES ($1, $2, $3, $4, 1, 1, 'platform_pipeline', 'unverified', $5, 'passed', 'v1.0.0', $6)`,
      [executionId, teamId, projectId, planId, runId, actorId],
    )
    await client.query(
      `INSERT INTO app.change_plan_event (id, team_id, project_id, plan_id, execution_id, event_type, actor_user_id, summary)
       VALUES ($1, $2, $3, $4, $5, 'completed', $6, '发布完成')`,
      [randomUUID(), teamId, projectId, planId, executionId, actorId],
    )
    await client.query(
      `INSERT INTO app.service_run_version
         (id, team_id, project_id, service_id, environment, version_label, source, evidence_url,
          verification_status, confirmed_by_user_id, confirmed_at)
       VALUES ($1, $3, $4, $5, 'test', 'v1.0.0', 'deployment_receipt', $6, 'confirmed', $8, $9),
              ($2, $3, $4, $5, 'production', 'v2.0.0', 'manual', $7, 'confirmed', $8, $9)`,
      [randomUUID(), randomUUID(), teamId, projectId, serviceId, planUrl, externalEvidenceUrl, actorId, confirmedAt],
    )
    await client.query(
      `INSERT INTO app.service_run_version_change
         (id, team_id, project_id, service_id, environment, new_version_label, previous_status, new_status,
          source, evidence_url, changed_by_user_id)
       VALUES ($1, $3, $4, $5, 'test', 'v1.0.0', 'unknown', 'confirmed', 'deployment_receipt', $6, $8),
              ($2, $3, $4, $5, 'production', 'v2.0.0', 'unknown', 'confirmed', 'manual', $7, $8)`,
      [randomUUID(), randomUUID(), teamId, projectId, serviceId, planUrl, externalEvidenceUrl, actorId],
    )
  } finally {
    await client.end()
  }
}
