import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { sql } from 'drizzle-orm'
import { Client } from 'pg'
import { loadConfig } from '../../src/platform/config/env.ts'
import { createDatabase } from '../../src/platform/database/client.ts'
import { migrateDatabase } from '../../src/platform/database/migrate.ts'
import { team, teamMember } from '../../src/modules/identity/identity.tables.ts'
import { createAuthenticatedUser } from '../support/auth.ts'
import { createHttpApp } from '../../src/bootstrap/create-http-app.ts'
import { createConfigurationService } from '../../src/modules/configuration/configuration.service.ts'
import { createSecretCipher } from '../../src/modules/configuration/configuration.crypto.ts'
import { verifySessionPassword } from '../../src/modules/identity/identity.password.ts'
import { FakeMailer } from '../support/fake-mailer.ts'

test('AES-256-GCM 凭据加密、列表脱敏、撤销与密文篡改拒绝', { timeout: 60_000 }, async (t) => {
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

  const encryptionKey = Buffer.alloc(32, 7).toString('base64')
  const config = loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: runtimeUrl.href,
    AUTH_SECRET: 'test-auth-secret-at-least-32-characters',
    GIT_CREDENTIAL_ENCRYPTION_KEY: encryptionKey,
    APP_ORIGIN: 'http://localhost:5173',
    AUTH_TRUSTED_ORIGINS: 'http://localhost:5173',
  })
  const app = createHttpApp(config, { mailer: new FakeMailer() })
  cleanup.push(async () => {
    await app.close()
  })
  const user = await createAuthenticatedUser(app, { name: '管理员' })
  const teamId = randomUUID()
  await app.db
    .insert(team)
    .values({ id: teamId, name: `team-${randomBytes(3).toString('hex')}`, created_by_user_id: user.userId })
  await app.db
    .insert(teamMember)
    .values({ id: randomUUID(), team_id: teamId, user_id: user.userId, role: 'admin', status: 'active' })

  const database = createDatabase(config, () => {})
  cleanup.push(async () => {
    await database.close()
  })
  const cipher = createSecretCipher(encryptionKey)
  const service = createConfigurationService({
    db: database.db,
    cipher,
    verifyPassword: (headers, password) => verifySessionPassword(app.auth, headers, password),
  })
  const actor = { id: user.userId, email: user.email, name: user.name }

  const created = await service.createSecret(actor, teamId, {
    kind: 'git_token',
    name: 'Gitea Token',
    value: 'plain-secret-value',
  })
  assert.equal(created.kind, 'git_token')
  assert.equal(created.keyVersion, 1)
  const listed = await service.listSecrets(actor, teamId)
  assert.equal(listed.length, 1)
  assert.equal(JSON.stringify(listed).includes('plain-secret-value'), false)
  assert.equal(await service.decryptSecret(teamId, created.id), 'plain-secret-value')

  const stored = await database.db.execute<{ ciphertext: string }>(sql`SELECT ciphertext FROM app.secret`)
  assert.ok(stored.rows[0]?.ciphertext)
  assert.equal(stored.rows[0].ciphertext.includes('plain-secret-value'), false)

  const tampered = cipher.encrypt('tamper-check')
  tampered.ciphertext = Buffer.from('tampered').toString('base64')
  assert.throws(() => cipher.decrypt(tampered), /authenticate|bad decrypt|Unsupported state/i)

  const revoked = await service.revokeSecret(actor, teamId, created.id)
  assert.equal(revoked.status, 'revoked')
  await assert.rejects(
    service.decryptSecret(teamId, created.id),
    (error: unknown) => error instanceof Error && 'code' in error && error.code === 'NOT_FOUND',
  )
})
