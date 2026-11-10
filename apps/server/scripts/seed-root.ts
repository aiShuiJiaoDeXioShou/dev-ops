import { loadConfig } from '../src/platform/config/env.ts'
import { createDatabase } from '../src/platform/database/client.ts'
import { createIdentityAuth } from '../src/modules/identity/identity.auth.ts'
import { seedRootAccount } from '../src/modules/identity/identity.seed.ts'

function readRequired(name: 'ROOT_EMAIL' | 'ROOT_INITIAL_PASSWORD'): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} 未配置，无法初始化 root 账号`)
  return value
}

const config = loadConfig(process.env)
const database = createDatabase(config, () => {})
const auth = createIdentityAuth(database.db, config)

try {
  const result = await seedRootAccount(
    database.db,
    auth,
    readRequired('ROOT_EMAIL'),
    readRequired('ROOT_INITIAL_PASSWORD'),
  )
  process.stdout.write(
    result.created
      ? `已创建 root 用户：${process.env.ROOT_EMAIL}\nroot 初始化完成。\n`
      : `root 用户已存在，跳过账号创建：${process.env.ROOT_EMAIL}\nroot 初始化完成。\n`,
  )
} finally {
  await database.close()
}
