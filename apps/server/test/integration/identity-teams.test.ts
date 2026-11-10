import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { test } from 'node:test'
import { Client } from 'pg'
import { createHttpApp } from '../../src/bootstrap/create-http-app.ts'
import { loadConfig } from '../../src/platform/config/env.ts'
import { migrateDatabase } from '../../src/platform/database/migrate.ts'
import { seedRootAccount } from '../../src/modules/identity/identity.seed.ts'
import { FakeMailer } from '../support/fake-mailer.ts'

function cookiesFrom(header: string | string[] | undefined): string {
  if (header === undefined) return ''
  const values = Array.isArray(header) ? header : [header]
  return values
    .flatMap((value) => value.split(/,(?=[^;]+=)/))
    .map((value) => value.trim().split(';')[0])
    .filter(Boolean)
    .join('; ')
}

function tokenFromMail(mailer: FakeMailer): string {
  const mail = mailer.sent.at(-1)
  assert.ok(mail, '应已发送邀请邮件')
  const match = /[?&]token=([A-Za-z0-9_-]+)/.exec(mail.text)
  assert.ok(match?.[1], '邀请邮件应包含 token')
  return decodeURIComponent(match[1])
}

test('团队邀请、开通、角色与最后管理员保护通过真实 HTTP 与数据库验证', { timeout: 90_000 }, async (t) => {
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
    DB_STATEMENT_TIMEOUT_MS: '1000',
    DB_LOCK_TIMEOUT_MS: '100',
  })
  const mailer = new FakeMailer()
  const app = createHttpApp(config, { mailer })
  cleanup.push(async () => {
    await app.close()
  })

  const rootEmail = `root-${randomBytes(4).toString('hex')}@example.test`
  await seedRootAccount(app.db, app.auth, rootEmail, 'root-password-123')
  const rootSignIn = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/sign-in/email',
    payload: { email: rootEmail, password: 'root-password-123' },
    headers: { origin: config.APP_ORIGIN },
  })
  assert.equal(rootSignIn.statusCode, 200, rootSignIn.body)
  const rootCookie = cookiesFrom(rootSignIn.headers['set-cookie'])

  const teamName = `team-${randomBytes(3).toString('hex')}`
  const adminEmail = `admin-${randomBytes(3).toString('hex')}@example.test`
  const created = await app.inject({
    method: 'POST',
    url: '/api/v1/platform/teams',
    payload: { name: teamName, adminEmail },
    headers: { cookie: rootCookie, origin: config.APP_ORIGIN },
  })
  assert.equal(created.statusCode, 200, created.body)
  const createdBody = created.json()
  assert.equal(createdBody.success, true)
  assert.equal(createdBody.data.team.name, teamName)
  const teamId = createdBody.data.team.id as string
  const adminToken = tokenFromMail(mailer)

  const publicInvitation = await app.inject(`/api/v1/invitations/${adminToken}`)
  assert.equal(publicInvitation.statusCode, 200)
  assert.equal(publicInvitation.json().data.teamName, teamName)

  const accepted = await app.inject({
    method: 'POST',
    url: `/api/v1/invitations/${adminToken}/accept`,
    payload: { password: 'admin-password-123', name: '管理员' },
    headers: { origin: config.APP_ORIGIN },
  })
  assert.equal(accepted.statusCode, 200, accepted.body)
  assert.equal(accepted.json().success, true)
  const adminCookie = cookiesFrom(accepted.headers['set-cookie'])
  assert.ok(adminCookie.length > 0)

  const myTeams = await app.inject({ method: 'GET', url: '/api/v1/me/teams', headers: { cookie: adminCookie } })
  assert.equal(myTeams.json().success, true)
  assert.equal(myTeams.json().data[0].role, 'admin')

  // 管理员邀请开发者；开发者接受后只读接口可用，管理接口被拒绝。
  const devEmail = `dev-${randomBytes(3).toString('hex')}@example.test`
  const invitedDev = await app.inject({
    method: 'POST',
    url: `/api/v1/teams/${teamId}/invitations`,
    payload: { email: devEmail, role: 'developer' },
    headers: { cookie: adminCookie, origin: config.APP_ORIGIN },
  })
  assert.equal(invitedDev.statusCode, 200, invitedDev.body)
  assert.equal(invitedDev.json().success, true)
  const devToken = tokenFromMail(mailer)
  const devAccepted = await app.inject({
    method: 'POST',
    url: `/api/v1/invitations/${devToken}/accept`,
    payload: { password: 'dev-password-123', name: '开发者' },
    headers: { origin: config.APP_ORIGIN },
  })
  assert.equal(devAccepted.statusCode, 200, devAccepted.body)
  const devCookie = cookiesFrom(devAccepted.headers['set-cookie'])

  const devInviteAttempt = await app.inject({
    method: 'POST',
    url: `/api/v1/teams/${teamId}/invitations`,
    payload: { email: `other-${randomBytes(3).toString('hex')}@example.test`, role: 'viewer' },
    headers: { cookie: devCookie, origin: config.APP_ORIGIN },
  })
  assert.equal(devInviteAttempt.statusCode, 200)
  assert.equal(devInviteAttempt.json().success, false)
  assert.equal(devInviteAttempt.json().code, 'FORBIDDEN')

  // 最后一位管理员不能被停用或降级。
  const members = await app.inject({
    method: 'GET',
    url: `/api/v1/teams/${teamId}/members`,
    headers: { cookie: adminCookie },
  })
  const adminMember = members.json().data.find((member: { email: string }) => member.email === adminEmail)
  assert.ok(adminMember)
  const lastAdmin = await app.inject({
    method: 'POST',
    url: `/api/v1/teams/${teamId}/members/${adminMember.userId}/update`,
    payload: { status: 'disabled' },
    headers: { cookie: adminCookie, origin: config.APP_ORIGIN },
  })
  assert.equal(lastAdmin.statusCode, 200)
  assert.equal(lastAdmin.json().success, false)
  assert.equal(lastAdmin.json().code, 'LAST_ADMIN_PROTECTED')

  // 跨团队访问被拒绝。
  const secondTeam = `team-${randomBytes(3).toString('hex')}`
  const secondCreated = await app.inject({
    method: 'POST',
    url: '/api/v1/platform/teams',
    payload: { name: secondTeam, adminEmail: `admin2-${randomBytes(3).toString('hex')}@example.test` },
    headers: { cookie: rootCookie, origin: config.APP_ORIGIN },
  })
  assert.equal(secondCreated.json().success, true, secondCreated.body)
  const secondTeamId = secondCreated.json().data.team.id as string
  const crossTeam = await app.inject({
    method: 'GET',
    url: `/api/v1/teams/${secondTeamId}/members`,
    headers: { cookie: devCookie },
  })
  assert.equal(crossTeam.statusCode, 200)
  assert.equal(crossTeam.json().success, false)
  assert.equal(crossTeam.json().code, 'FORBIDDEN')
})
