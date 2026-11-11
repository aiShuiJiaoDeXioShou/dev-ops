import assert from 'node:assert/strict'
import { test } from 'node:test'
import { loadConfig } from '../src/platform/config/env.ts'

const databaseUrl = 'postgresql://test_user:unit_test@127.0.0.1:1/dev_ops_test'

function readConfig(env: NodeJS.ProcessEnv = {}) {
  return loadConfig({ DATABASE_URL: databaseUrl, ...env })
}

test('configuration applies defaults without reading the host environment', () => {
  const config = readConfig({})
  assert.equal(config.PORT, 3001)
  assert.equal(config.HOST, '127.0.0.1')
  assert.equal(config.NODE_ENV, 'development')
  assert.equal(config.DOCS_ENABLED, true)
  assert.equal(config.PIPELINE_STORAGE_DIR, './pipeline-data')
  assert.equal(config.PIPELINE_RUN_TIMEOUT_SECONDS, 3600)
  assert.equal(config.PIPELINE_LEASE_TTL_SECONDS, 90)
  assert.equal(config.PIPELINE_HEARTBEAT_TIMEOUT_SECONDS, 60)
  assert.equal(config.PIPELINE_WORKFLOW_MAX_BYTES, 131_072)
  assert.equal(config.PIPELINE_LOG_CHUNK_MAX_BYTES, 262_144)
  assert.equal(config.PIPELINE_ARTIFACT_MAX_BYTES, 524_288_000)
  assert.equal(config.CODE_CHANGE_PATCH_MAX_BYTES, 1_048_576)
  assert.equal(config.CODE_CHANGE_DIFF_RESPONSE_MAX_BYTES, 262_144)
  assert.equal(config.CODE_CHANGE_TIMEOUT_SECONDS, 900)
  assert.equal(config.DEPLOY_VERIFY_TIMEOUT_SECONDS, 30)
  assert.equal(config.CHANGE_PLAN_LIST_MAX_PAGE_SIZE, 100)
})

test('configuration parses environment strings and production defaults', () => {
  assert.equal(readConfig({ PORT: '4010' }).PORT, 4010)
  assert.equal(readConfig({ NODE_ENV: 'production' }).DOCS_ENABLED, false)
  assert.equal(readConfig({ DOCS_ENABLED: 'false' }).DOCS_ENABLED, false)
  assert.equal(readConfig({ NODE_ENV: 'production', DOCS_ENABLED: 'true' }).DOCS_ENABLED, true)
})

test('invalid configuration prevents startup', () => {
  for (const PORT of ['0', '-1', '65536', 'abc', '1.5', '']) {
    assert.throws(() => readConfig({ PORT }), /PORT/)
  }
  assert.throws(() => readConfig({ NODE_ENV: 'staging' }))
  assert.throws(() => readConfig({ LOG_LEVEL: 'verbose' }))
  assert.throws(() => readConfig({ DOCS_ENABLED: 'yes' }))
})

test('数据库配置必须完整且错误不泄露连接凭据', () => {
  assert.throws(() => loadConfig({}), /DATABASE_URL/)
  for (const DATABASE_URL of ['', 'invalid', 'https://host/database', 'postgresql://host/']) {
    assert.throws(() => readConfig({ DATABASE_URL }), /DATABASE_URL/)
  }
  assert.throws(
    () => readConfig({ DATABASE_URL: 'https://user:private_password@host/database' }),
    (error: unknown) => {
      assert.ok(error instanceof Error)
      assert.match(error.message, /DATABASE_URL/)
      assert.equal(error.message.includes('private_password'), false)
      return true
    },
  )
  assert.equal(readConfig().DB_POOL_MAX, 10)
  assert.equal(readConfig({ DB_POOL_MAX: '4' }).DB_POOL_MAX, 4)
  for (const name of [
    'DB_POOL_MAX',
    'DB_CONNECT_TIMEOUT_MS',
    'DB_IDLE_TIMEOUT_MS',
    'DB_STATEMENT_TIMEOUT_MS',
    'DB_LOCK_TIMEOUT_MS',
    'DB_IDLE_TRANSACTION_TIMEOUT_MS',
  ]) {
    for (const value of ['0', '-1', '1.5', 'invalid', '9999999']) {
      assert.throws(() => readConfig({ [name]: value }), new RegExp(name))
    }
  }
})

test('V0.1 认证、邮件与 GitHub 配置校验', () => {
  const base = readConfig({})
  assert.equal(base.APP_ORIGIN, 'http://localhost:5173')
  assert.deepEqual(base.AUTH_TRUSTED_ORIGINS, ['http://localhost:5173'])
  assert.equal(base.GITHUB_AUTH_MODE, 'cli')
  assert.deepEqual(base.GITHUB_ALLOWED_REPOS, [])
  assert.equal(base.SMTP_URL, undefined)
  assert.equal(base.MAIL_FROM, undefined)
  assert.equal(base.GIT_CREDENTIAL_ENCRYPTION_KEY, undefined)

  for (const APP_ORIGIN of [
    'invalid',
    'file:///tmp',
    'https://user:secret@example.test',
    'https://example.test/path',
  ]) {
    assert.throws(() => readConfig({ APP_ORIGIN }), /APP_ORIGIN/)
  }
  const trusted = readConfig({
    APP_ORIGIN: 'https://stg.example.test',
    AUTH_TRUSTED_ORIGINS: 'https://stg.example.test,http://localhost:5173',
  })
  assert.deepEqual(trusted.AUTH_TRUSTED_ORIGINS, ['https://stg.example.test', 'http://localhost:5173'])
  assert.deepEqual(readConfig({ AUTH_TRUSTED_ORIGINS: 'http://127.0.0.1:5173' }).AUTH_TRUSTED_ORIGINS, [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
  ])

  assert.equal(
    readConfig({ SMTP_URL: 'smtps://user:pass@smtp.example.test:465' }).SMTP_URL,
    'smtps://user:pass@smtp.example.test:465',
  )
  for (const SMTP_URL of ['invalid', 'https://smtp.example.test', 'smtp://']) {
    assert.throws(() => readConfig({ SMTP_URL }), /SMTP_URL/)
  }
  for (const MAIL_FROM of ['invalid', 'a@b', 'a b@example.test']) {
    assert.throws(() => readConfig({ MAIL_FROM }), /MAIL_FROM/)
  }
  assert.equal(readConfig({ MAIL_FROM: 'noreply@example.test' }).MAIL_FROM, 'noreply@example.test')

  const key = Buffer.alloc(32, 1).toString('base64')
  assert.equal(readConfig({ GIT_CREDENTIAL_ENCRYPTION_KEY: key }).GIT_CREDENTIAL_ENCRYPTION_KEY, key)
  for (const GIT_CREDENTIAL_ENCRYPTION_KEY of ['invalid', Buffer.alloc(16, 1).toString('base64')]) {
    assert.throws(() => readConfig({ GIT_CREDENTIAL_ENCRYPTION_KEY }), /GIT_CREDENTIAL_ENCRYPTION_KEY/)
  }

  assert.equal(readConfig({ GITHUB_AUTH_MODE: 'app' }).GITHUB_AUTH_MODE, 'app')
  assert.throws(() => readConfig({ GITHUB_AUTH_MODE: 'oauth' }))
  assert.deepEqual(readConfig({ GITHUB_ALLOWED_REPOS: 'owner/repo, other/repo-2' }).GITHUB_ALLOWED_REPOS, [
    'owner/repo',
    'other/repo-2',
  ])
  assert.throws(() => readConfig({ GITHUB_ALLOWED_REPOS: 'not-a-repo' }), /GITHUB_ALLOWED_REPOS/)
  assert.throws(() => readConfig({ GITHUB_APP_ID: 'abc' }))
  assert.throws(() => readConfig({ GITHUB_APP_SLUG: 'bad slug' }))
})
