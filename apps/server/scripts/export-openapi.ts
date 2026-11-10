import { mkdir, writeFile } from 'node:fs/promises'
import { createHttpApp } from '../src/bootstrap/create-http-app.ts'
import { loadConfig } from '../src/platform/config/env.ts'

// 契约导出只组装路由，不探测数据库，也不读取本地凭据或监听端口。
const app = createHttpApp(
  loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DOCS_ENABLED: 'true',
    DATABASE_URL: 'postgresql://contract@127.0.0.1:1/contract',
    AUTH_SECRET: 'contract-export-secret-at-least-32-characters',
    GIT_CREDENTIAL_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
  }),
)
try {
  await app.ready()
  const output = new URL('../../../.artifacts/openapi.json', import.meta.url)
  await mkdir(new URL('.', output), { recursive: true })
  await writeFile(output, `${JSON.stringify(app.swagger(), null, 2)}\n`)
  process.stdout.write('已从已注册路由导出 OpenAPI 契约。\n')
} finally {
  await app.close()
}
