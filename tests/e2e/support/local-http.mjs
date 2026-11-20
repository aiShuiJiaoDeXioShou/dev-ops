import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseEnv } from 'node:util'
import { createHttpApp } from '../../../apps/server/dist/bootstrap/create-http-app.js'
import { loadConfig } from '../../../apps/server/dist/platform/config/env.js'
import { migrateDatabase } from '../../../apps/server/dist/platform/database/migrate.js'
import { seedRootAccount } from '../../../apps/server/dist/modules/identity/identity.seed.js'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const requireFromServer = createRequire(join(root, 'apps/server/package.json'))
const { Client } = requireFromServer('pg')

async function readEnvFile(relativePath) {
  try {
    return parseEnv(await readFile(join(root, relativePath), 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT') return {}
    throw error
  }
}

function tokenFromMail(text) {
  const match = /[?&]token=([A-Za-z0-9_-]+)/.exec(text)
  assert.ok(match?.[1], '邀请邮件应包含 token')
  return decodeURIComponent(match[1])
}

/**
 * 创建经真实 HTTP 邀请流程开通的团队和独立本机 PostgreSQL 数据库。
 * @param t Node 测试上下文，测试完成后自动清理。
 * @returns 成员会话、数据库配置和 HTTP 请求入口；本地依赖未配置时跳过测试。
 */
export async function createLocalHttpFixture(t) {
  const env = { ...(await readEnvFile('apps/server/.env.database')), ...(await readEnvFile('apps/server/.env')) }
  const runtimeValue = process.env.DATABASE_URL ?? env.DATABASE_URL
  const migrationValue = process.env.MIGRATION_DATABASE_URL ?? env.MIGRATION_DATABASE_URL
  const adminPassword = process.env.POSTGRES_PASSWORD ?? env.POSTGRES_PASSWORD
  if (!runtimeValue || !migrationValue || !adminPassword) {
    t.skip('未提供本机数据库环境，跳过需要真实 PostgreSQL 的验收')
    return
  }
  const runtimeUrl = new URL(runtimeValue)
  const migrationUrl = new URL(migrationValue)
  if (runtimeUrl.hostname !== '127.0.0.1' || migrationUrl.host !== runtimeUrl.host) {
    t.skip('仅在本机 Compose 数据库执行')
    return
  }
  const databaseName = `dev_ops_http_e2e_${randomBytes(8).toString('hex')}`
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
    if (errors.length > 0) throw new AggregateError(errors, 'HTTP 验收清理失败')
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
    GIT_CREDENTIAL_ENCRYPTION_KEY: Buffer.alloc(32, 45).toString('base64'),
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
    body: { name: `http-e2e-${randomBytes(3).toString('hex')}`, adminEmail },
  })
  assert.equal(createdTeam.body.success, true, JSON.stringify(createdTeam.body))
  const teamId = createdTeam.body.data.team.id
  const inviteToken = tokenFromMail(mailer.sent.at(-1).text)
  const accepted = await request(`/api/v1/invitations/${inviteToken}/accept`, {
    method: 'POST',
    body: { password: 'admin-password-123', name: '测试管理员' },
    headers: { origin: config.APP_ORIGIN },
  })
  assert.equal(accepted.body.success, true, JSON.stringify(accepted.body))
  const me = await request('/api/v1/me')
  assert.equal(me.body.success, true)
  function post(path, body) {
    return request(path, { method: 'POST', body, headers: { 'idempotency-key': randomUUID() } })
  }
  return { app, address, cleanup, config, env, request, post, teamId, user: me.body.data.user ?? me.body.data }
}
