import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createHttpApp } from '../../apps/server/dist/bootstrap/create-http-app.js'
import { loadConfig } from '../../apps/server/dist/platform/config/env.js'
import { migrateDatabase } from '../../apps/server/dist/platform/database/migrate.js'
import { seedRootAccount } from '../../apps/server/dist/modules/identity/identity.seed.js'

const root = fileURLToPath(new URL('../../', import.meta.url))
const requireFromServer = createRequire(join(root, 'apps/server/package.json'))
const { Client } = requireFromServer('pg')

async function readEnvFile(relativePath) {
  try {
    const text = await readFile(join(root, relativePath), 'utf8')
    const values = {}
    for (const line of text.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const index = trimmed.indexOf('=')
      if (index <= 0) continue
      values[trimmed.slice(0, index)] = trimmed.slice(index + 1)
    }
    return values
  } catch {
    return {}
  }
}

function tokenFromMail(text) {
  const match = /[?&]token=([A-Za-z0-9_-]+)/.exec(text)
  assert.ok(match?.[1], '邀请邮件应包含 token')
  return decodeURIComponent(match[1])
}

test('真实 HTTP：邀请 → 项目 → 需求 → 提测 → Bug 回归 → 测试通过', { timeout: 120_000 }, async (t) => {
  const env = { ...(await readEnvFile('apps/server/.env.database')), ...(await readEnvFile('apps/server/.env')) }
  const runtimeValue = process.env.DATABASE_URL ?? env.DATABASE_URL
  const migrationValue = process.env.MIGRATION_DATABASE_URL ?? env.MIGRATION_DATABASE_URL
  const adminPassword = process.env.POSTGRES_PASSWORD ?? env.POSTGRES_PASSWORD
  if (!runtimeValue || !migrationValue || !adminPassword) {
    t.skip('未提供本机数据库环境，跳过真实 e2e')
    return
  }
  const runtimeUrl = new URL(runtimeValue)
  const migrationUrl = new URL(migrationValue)
  if (runtimeUrl.hostname !== '127.0.0.1' || migrationUrl.host !== runtimeUrl.host) {
    t.skip('仅在本机 Compose 数据库执行')
    return
  }

  const databaseName = `dev_ops_e2e_${randomBytes(8).toString('hex')}`
  const cleanup = []
  t.after(async () => {
    const errors = []
    for (const dispose of cleanup.reverse()) {
      try {
        await dispose()
      } catch (error) {
        errors.push(error)
      }
    }
    if (errors.length > 0) throw new AggregateError(errors, 'e2e 清理失败')
  })
  const admin = new Client({
    host: runtimeUrl.hostname,
    port: Number(runtimeUrl.port || '5432'),
    user: 'postgres',
    password: adminPassword,
    database: 'postgres',
    connectionTimeoutMillis: 5_000,
  })
  await admin.connect()
  cleanup.push(() => admin.end())
  await admin.query(`CREATE DATABASE "${databaseName}" OWNER dev_ops_migrator`)
  cleanup.push(() => admin.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`))
  await admin.query(`REVOKE ALL ON DATABASE "${databaseName}" FROM PUBLIC`)
  await admin.query(`GRANT CONNECT ON DATABASE "${databaseName}" TO dev_ops_app`)
  runtimeUrl.pathname = `/${databaseName}`
  migrationUrl.pathname = `/${databaseName}`
  await migrateDatabase(migrationUrl.href)

  const mailer = {
    sent: [],
    async send(message) {
      this.sent.push(message)
    },
  }
  const config = loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: runtimeUrl.href,
    AUTH_SECRET: env.AUTH_SECRET ?? 'e2e-auth-secret-at-least-32-characters',
    APP_ORIGIN: 'http://127.0.0.1:5173',
    AUTH_TRUSTED_ORIGINS: 'http://127.0.0.1:5173',
    DB_STATEMENT_TIMEOUT_MS: '2000',
    DB_LOCK_TIMEOUT_MS: '1000',
  })
  const app = createHttpApp(config, { mailer })
  cleanup.push(() => app.close())
  const address = await app.listen({ port: 0, host: '127.0.0.1' })

  let cookieJar = ''
  async function request(path, options = {}) {
    const headers = { accept: 'application/json', ...(options.headers ?? {}) }
    if (cookieJar) headers.cookie = cookieJar
    if (options.body !== undefined) headers['content-type'] = 'application/json'
    const response = await fetch(`${address}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    })
    const cookies = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : []
    if (cookies.length > 0) {
      const jar = new Map(
        cookieJar
          .split('; ')
          .filter(Boolean)
          .map((item) => [item.split('=')[0], item]),
      )
      for (const cookie of cookies) {
        const pair = cookie.split(';')[0]
        jar.set(pair.split('=')[0], pair)
      }
      cookieJar = [...jar.values()].join('; ')
    }
    const body = await response.json()
    return { status: response.status, body }
  }

  const rootEmail = `root-${randomBytes(4).toString('hex')}@example.test`
  const rootPassword = 'root-password-123'
  await seedRootAccount(app.db, app.auth, rootEmail, rootPassword)
  const rootSignIn = await request('/api/v1/auth/sign-in/email', {
    method: 'POST',
    body: { email: rootEmail, password: rootPassword },
    headers: { origin: config.APP_ORIGIN },
  })
  assert.equal(rootSignIn.status, 200, JSON.stringify(rootSignIn.body))

  const teamName = `e2e-${randomBytes(3).toString('hex')}`
  const adminEmail = `admin-${randomBytes(3).toString('hex')}@example.test`
  const createdTeam = await request('/api/v1/platform/teams', { method: 'POST', body: { name: teamName, adminEmail } })
  assert.equal(createdTeam.body.success, true, JSON.stringify(createdTeam.body))
  const teamId = createdTeam.body.data.team.id
  const adminToken = tokenFromMail(mailer.sent.at(-1).text)
  const publicInvite = await request(`/api/v1/invitations/${adminToken}`)
  assert.equal(publicInvite.body.data.teamName, teamName)
  const acceptedAdmin = await request(`/api/v1/invitations/${adminToken}/accept`, {
    method: 'POST',
    body: { password: 'admin-password-123', name: '管理员' },
    headers: { origin: config.APP_ORIGIN },
  })
  assert.equal(acceptedAdmin.body.success, true, JSON.stringify(acceptedAdmin.body))
  const savedAdminCookie = cookieJar

  const devEmail = `dev-${randomBytes(3).toString('hex')}@example.test`
  const invitedDev = await request(`/api/v1/teams/${teamId}/invitations`, {
    method: 'POST',
    body: { email: devEmail, role: 'developer' },
  })
  assert.equal(invitedDev.body.success, true, JSON.stringify(invitedDev.body))
  const devToken = tokenFromMail(mailer.sent.at(-1).text)
  const acceptedDev = await request(`/api/v1/invitations/${devToken}/accept`, {
    method: 'POST',
    body: { password: 'dev-password-123', name: '开发者' },
    headers: { origin: config.APP_ORIGIN },
  })
  assert.equal(acceptedDev.body.success, true, JSON.stringify(acceptedDev.body))
  const adminUser = acceptedAdmin.body.data
  const devUser = acceptedDev.body.data
  cookieJar = savedAdminCookie
  const adminTeams = await request('/api/v1/me/teams')
  assert.equal(adminTeams.body.data.teams[0].role, 'admin')

  // 管理员会话创建项目。
  cookieJar = savedAdminCookie
  const createdProject = await request(`/api/v1/teams/${teamId}/projects`, {
    method: 'POST',
    body: { name: 'E2E 项目' },
  })
  assert.equal(createdProject.body.success, true, JSON.stringify(createdProject.body))
  const projectId = createdProject.body.data.id

  const createdRequirement = await request(`/api/v1/projects/${projectId}/requirements`, {
    method: 'POST',
    body: {
      title: 'E2E 登录',
      contentMode: 'markdown',
      contentMarkdown: '正文',
      devOwnerUserId: devUser.userId,
      testOwnerUserId: adminUser.userId,
    },
  })
  assert.equal(createdRequirement.body.success, true, JSON.stringify(createdRequirement.body))
  const requirement = createdRequirement.body.data

  // 切到开发者执行开始开发与提测。
  cookieJar = acceptedDev.body.cookie ?? ''
  const devSignIn = await request('/api/v1/auth/sign-in/email', {
    method: 'POST',
    body: { email: devEmail, password: 'dev-password-123' },
    headers: { origin: config.APP_ORIGIN },
  })
  assert.equal(devSignIn.status, 200)
  const devCookie = cookieJar
  void devCookie
  const started = await request(`/api/v1/requirements/${requirement.id}/start-development`, {
    method: 'POST',
    body: { version: requirement.version },
  })
  assert.equal(started.body.success, true, JSON.stringify(started.body))
  const submitted = await request(`/api/v1/requirements/${requirement.id}/submit-test`, {
    method: 'POST',
    body: {
      version: started.body.data.version,
      testOwnerUserId: adminUser.userId,
      scopeNote: '登录范围',
      selfTestResult: 'passed',
    },
    headers: { 'idempotency-key': 'e2e-submit-test' },
  })
  assert.equal(submitted.body.success, true, JSON.stringify(submitted.body))
  const submittedRequirement = submitted.body.data.requirement

  cookieJar = savedAdminCookie
  const startTest = await request(`/api/v1/requirements/${requirement.id}/start-test`, {
    method: 'POST',
    body: { version: submittedRequirement.version },
  })
  assert.equal(startTest.body.success, true, JSON.stringify(startTest.body))

  const createdBug = await request(`/api/v1/projects/${projectId}/bugs`, {
    method: 'POST',
    body: {
      title: 'E2E 登录闪退',
      phenomenon: '闪退',
      expectedBehavior: '成功',
      reproduction: '步骤',
      fixOwnerUserId: devUser.userId,
      requirementIds: [requirement.id],
    },
  })
  assert.equal(createdBug.body.success, true, JSON.stringify(createdBug.body))
  const bug = createdBug.body.data
  cookieJar = ''
  const devSignInAgain = await request('/api/v1/auth/sign-in/email', {
    method: 'POST',
    body: { email: devEmail, password: 'dev-password-123' },
    headers: { origin: config.APP_ORIGIN },
  })
  assert.equal(devSignInAgain.status, 200)
  const fixStarted = await request(`/api/v1/bugs/${bug.id}/start-fix`, {
    method: 'POST',
    body: { version: bug.version },
  })
  const regressionSubmitted = await request(`/api/v1/bugs/${bug.id}/submit-regression`, {
    method: 'POST',
    body: { version: fixStarted.body.data.version, fixSummary: '修复闪退', verifierUserId: adminUser.userId },
  })
  assert.equal(regressionSubmitted.body.success, true, JSON.stringify(regressionSubmitted.body))
  cookieJar = savedAdminCookie
  const regressionPassed = await request(`/api/v1/bugs/${bug.id}/record-regression`, {
    method: 'POST',
    body: { version: regressionSubmitted.body.data.bug.version, result: 'passed', note: '回归通过' },
  })
  assert.equal(regressionPassed.body.data.status, 'resolved', JSON.stringify(regressionPassed.body))

  const eligibility = await request(`/api/v1/requirements/${requirement.id}/test-pass-eligibility`)
  assert.equal(eligibility.body.data.eligible, true)
  const tested = await request(`/api/v1/requirements/${requirement.id}/pass-test`, {
    method: 'POST',
    body: { version: startTest.body.data.version, conclusion: '测试通过' },
  })
  assert.equal(tested.body.data.status, 'passed', JSON.stringify(tested.body))

  const ready = await request('/api/v1/ready')
  assert.equal(ready.body.success, true)
})
