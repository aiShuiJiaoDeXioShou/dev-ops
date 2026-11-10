import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
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

test('真实 HTTP：Skills/模板生命周期、项目选用与快照权限', { timeout: 120_000 }, async (t) => {
  const env = { ...(await readEnvFile('apps/server/.env.database')), ...(await readEnvFile('apps/server/.env')) }
  const runtimeValue = process.env.DATABASE_URL ?? env.DATABASE_URL
  const migrationValue = process.env.MIGRATION_DATABASE_URL ?? env.MIGRATION_DATABASE_URL
  const adminPassword = process.env.POSTGRES_PASSWORD ?? env.POSTGRES_PASSWORD
  if (!runtimeValue || !migrationValue || !adminPassword) {
    t.skip('未提供本机数据库环境，跳过知识资产 e2e')
    return
  }
  const runtimeUrl = new URL(runtimeValue)
  const migrationUrl = new URL(migrationValue)
  if (runtimeUrl.hostname !== '127.0.0.1' || migrationUrl.host !== runtimeUrl.host) {
    t.skip('仅在本机 Compose 数据库执行')
    return
  }
  const databaseName = `dev_ops_knowledge_e2e_${randomBytes(8).toString('hex')}`
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
    if (errors.length > 0) throw new AggregateError(errors, '知识资产 e2e 清理失败')
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
    return { status: response.status, body: await response.json() }
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

  const adminEmail = `admin-${randomBytes(3).toString('hex')}@example.test`
  const createdTeam = await request('/api/v1/platform/teams', {
    method: 'POST',
    body: { name: `knowledge-e2e-${randomBytes(3).toString('hex')}`, adminEmail },
  })
  assert.equal(createdTeam.body.success, true, JSON.stringify(createdTeam.body))
  const teamId = createdTeam.body.data.team.id
  const inviteToken = tokenFromMail(mailer.sent.at(-1).text)
  const accepted = await request(`/api/v1/invitations/${inviteToken}/accept`, {
    method: 'POST',
    body: { password: 'admin-password-123', name: '知识管理员' },
    headers: { origin: config.APP_ORIGIN },
  })
  assert.equal(accepted.body.success, true, JSON.stringify(accepted.body))
  const adminCookie = cookieJar

  const projectResponse = await request(`/api/v1/teams/${teamId}/projects`, {
    method: 'POST',
    body: { name: '知识资产 E2E 项目' },
  })
  assert.equal(projectResponse.body.success, true, JSON.stringify(projectResponse.body))
  const projectId = projectResponse.body.data.id

  const skillResponse = await request(`/api/v1/teams/${teamId}/skills`, {
    method: 'POST',
    body: {
      name: 'E2E 技能',
      identifier: 'e2e-skill',
      category: 'engineering',
      contentVersion: '1.0.0',
      summary: 'E2E 简述',
      content: '# E2E\n\n检查风险。',
      files: [{ path: 'references/check.md', content: '检查项', encoding: 'utf8' }],
    },
  })
  assert.equal(skillResponse.body.success, true, JSON.stringify(skillResponse.body))
  const skill = skillResponse.body.data
  const skillList = await request(`/api/v1/teams/${teamId}/skills?search=E2E`)
  assert.equal(skillList.body.data.total, 1)
  assert.equal(skillList.body.data.items[0].selectedProjectCount ?? 0, 0)

  const templateResponse = await request(`/api/v1/teams/${teamId}/agent-templates`, {
    method: 'POST',
    body: { name: 'E2E 模板', tag: '团队', content: '# AGENTS.md\n\n协作约定。' },
  })
  assert.equal(templateResponse.body.success, true, JSON.stringify(templateResponse.body))
  const template = templateResponse.body.data
  assert.equal(template.selectedProjectCount, 0)
  const applyResponse = await request(`/api/v1/projects/${projectId}/agent-template/apply`, {
    method: 'POST',
    body: { templateId: template.id, version: 0 },
  })
  assert.equal(applyResponse.body.success, true, JSON.stringify(applyResponse.body))
  const selected = await request(`/api/v1/projects/${projectId}/agent-template`)
  assert.equal(selected.body.data.selection.templateId, template.id)
  const templatesAfter = await request(`/api/v1/teams/${teamId}/agent-templates`)
  const listed = templatesAfter.body.data.items.find((item) => item.id === template.id)
  assert.equal(listed.selectedProjectCount, 1)

  const snapshotResponse = await request(`/api/v1/agent-templates/${template.id}/snapshot-links`, {
    method: 'POST',
  })
  assert.equal(snapshotResponse.body.success, true, JSON.stringify(snapshotResponse.body))
  const snapshotToken = snapshotResponse.body.data.token
  const snapshot = await request(`/api/v1/template-snapshot-links/${snapshotToken}`)
  assert.equal(snapshot.body.data.contentVersion, 1)

  cookieJar = ''
  const anonymousSnapshot = await request(`/api/v1/template-snapshot-links/${snapshotToken}`)
  assert.equal(anonymousSnapshot.body.code, 'UNAUTHENTICATED')
  cookieJar = adminCookie
  const skillsReload = await request(`/api/v1/teams/${teamId}/skills`)
  assert.equal(skillsReload.body.data.items[0].id, skill.id)
  const ready = await request('/api/v1/ready')
  assert.equal(ready.body.success, true)
})
