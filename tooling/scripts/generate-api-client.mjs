import { mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import openapiTS, { astToString } from 'openapi-typescript'

const input = new URL('../../.artifacts/openapi.json', import.meta.url)
const output = new URL('../../packages/api-client/src/generated/', import.meta.url)
let document = JSON.parse(await readFile(input, 'utf8'))
// 协议端点不进入生成客户端；OpenAPI 导出仍保留，供认证客户端手工适配。
document = {
  ...document,
  paths: Object.fromEntries(Object.entries(document.paths ?? {}).filter(([path]) => !path.startsWith('/api/v1/auth/'))),
}
await rm(output, { recursive: true, force: true })
await mkdir(output, { recursive: true })
const filteredInput = new URL('../../.artifacts/openapi.client.json', import.meta.url)
await writeFile(filteredInput, JSON.stringify(document))
await writeFile(new URL('api.ts', output), astToString(await openapiTS(filteredInput)))
await rm(filteredInput, { force: true })
process.stdout.write('已从 OpenAPI 生成接口类型。\n')
