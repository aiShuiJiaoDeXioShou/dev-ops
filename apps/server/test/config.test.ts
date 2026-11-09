import assert from 'node:assert/strict'
import { test } from 'node:test'
import { loadConfig } from '../src/platform/config/env.js'

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
  assert.throws(() => readConfig({ DATABASE_URL: 'https://user:private_password@host/database' }), (error: unknown) => {
    assert.ok(error instanceof Error)
    assert.match(error.message, /DATABASE_URL/)
    assert.equal(error.message.includes('private_password'), false)
    return true
  })
  assert.equal(readConfig().DB_POOL_MAX, 10)
  assert.equal(readConfig({ DB_POOL_MAX: '4' }).DB_POOL_MAX, 4)
  for (const name of ['DB_POOL_MAX', 'DB_CONNECT_TIMEOUT_MS', 'DB_IDLE_TIMEOUT_MS', 'DB_STATEMENT_TIMEOUT_MS', 'DB_LOCK_TIMEOUT_MS', 'DB_IDLE_TRANSACTION_TIMEOUT_MS']) {
    for (const value of ['0', '-1', '1.5', 'invalid', '9999999']) {
      assert.throws(() => readConfig({ [name]: value }), new RegExp(name))
    }
  }
})
