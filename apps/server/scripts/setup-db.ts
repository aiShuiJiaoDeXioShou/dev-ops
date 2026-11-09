import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const runtimeFile = new URL('../.env', import.meta.url)
const databaseFile = new URL('../.env.database', import.meta.url)

try {
  if (existsSync(runtimeFile) && existsSync(databaseFile)) {
    process.stdout.write('本地数据库配置已存在，保留原有内容。\n')
  } else if (existsSync(runtimeFile) || existsSync(databaseFile)) {
    throw new Error('存在部分本地配置，请按示例补齐另一份配置；不会覆盖现有文件')
  } else {
    const adminPassword = randomBytes(24).toString('hex')
    const appPassword = randomBytes(24).toString('hex')
    const migrationPassword = randomBytes(24).toString('hex')
    const runtime = readFileSync(new URL('../.env.example', import.meta.url), 'utf8').replace(
      'dev_ops_app:replace_me',
      `dev_ops_app:${appPassword}`,
    )
    const database = [
      '# 本地开发配置，不得提交或复用到生产环境。',
      'POSTGRES_PORT=5433',
      `POSTGRES_PASSWORD=${adminPassword}`,
      `APP_DATABASE_PASSWORD=${appPassword}`,
      `MIGRATION_DATABASE_PASSWORD=${migrationPassword}`,
      `MIGRATION_DATABASE_URL=postgresql://dev_ops_migrator:${migrationPassword}@127.0.0.1:5433/dev_ops`,
      '',
    ].join('\n')
    writeFileSync(runtimeFile, runtime, { flag: 'wx', mode: 0o600 })
    writeFileSync(databaseFile, database, { flag: 'wx', mode: 0o600 })
    process.stdout.write('已生成 apps/server/.env 与 apps/server/.env.database，使用独立随机密码。\n')
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : '本地配置生成失败'}。\n`)
  process.exitCode = 1
}
