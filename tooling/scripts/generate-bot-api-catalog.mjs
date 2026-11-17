import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { catalogBotApis } from '../../apps/server/src/modules/bots/bots.api-catalog.ts'

const document = JSON.parse(await readFile(new URL('../../.artifacts/openapi.json', import.meta.url), 'utf8'))
const catalog = catalogBotApis(document)
const destination = new URL('../../.artifacts/bot-api-catalog.json', import.meta.url)
await mkdir(new URL('.', destination), { recursive: true })
await writeFile(destination, `${JSON.stringify(catalog, null, 2)}\n`)
process.stdout.write(`已从 OpenAPI 生成 ${catalog.length} 条 Bot 平台 API。\n`)
