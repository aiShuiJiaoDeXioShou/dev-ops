import { mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import openapiTS, { astToString } from 'openapi-typescript'
import { Ajv } from 'ajv'
import standaloneCode from 'ajv/dist/standalone/index.js'

const input = new URL('../../.artifacts/openapi.json', import.meta.url)
const output = new URL('../../packages/api-client/src/generated/', import.meta.url)
let document = JSON.parse(await readFile(input, 'utf8'))
// 协议端点不进入生成客户端；OpenAPI 导出仍保留，供认证客户端手工适配。
document = {
  ...document,
  paths: Object.fromEntries(Object.entries(document.paths ?? {}).filter(([path]) => !path.startsWith('/api/v1/auth/'))),
}
const schemas = document.components?.schemas
await rm(output, { recursive: true, force: true })
await mkdir(output, { recursive: true })
const filteredInput = new URL('../../.artifacts/openapi.client.json', import.meta.url)
await writeFile(filteredInput, JSON.stringify(document))
await writeFile(new URL('api.ts', output), astToString(await openapiTS(filteredInput)))
await rm(filteredInput, { force: true })
const validator = new Ajv({ code: { source: true, esm: true } })
for (const [name, schema] of Object.entries(schemas ?? {})) {
  validator.addSchema(schema, `#/components/schemas/${name}`)
}
// CLI 的 JSON 文件与筛选参数使用与服务端相同的结构校验。
const inputs = []
for (const [path, item] of Object.entries(document.paths)) {
  const body = item.post?.requestBody?.content?.['application/json']?.schema
  const params = item.get?.parameters?.filter((parameter) => parameter.in === 'query') ?? []
  const query = params.length
    ? {
        type: 'object',
        properties: Object.fromEntries(params.map(({ name, schema }) => [name, schema])),
        required: params.filter((parameter) => parameter.required).map(({ name }) => name),
        additionalProperties: false,
      }
    : undefined
  for (const [kind, schema] of [
    ['body', body],
    ['query', query],
  ]) {
    if (!schema) continue
    const name = `input-${inputs.length}.mjs`
    let source = standaloneCode(validator, validator.compile(schema))
    const lengthHelper = 'require("ajv/dist/runtime/ucs2length").default'
    if (source.includes(lengthHelper)) {
      // JSON Schema 的字符串长度按 Unicode 码点计算，CLI 校验器保持独立 ESM。
      source =
        'function unicodeLength(value) { let length = 0; for (const character of value) length += 1; return length }\n' +
        source.replaceAll(lengthHelper, 'unicodeLength')
    }
    if (/\brequire\(/.test(source)) throw new Error(`输入校验器 ${kind} ${path} 需要额外运行库`)
    await writeFile(new URL(name, output), source)
    inputs.push({ kind, path, name })
  }
}
await writeFile(
  new URL('input-validators.mjs', output),
  [
    ...inputs.map(({ name }, index) => `import v${index} from './${name}'`),
    '',
    'const validators = {',
    ...inputs.map(({ kind, path }, index) => `  ${JSON.stringify(`${kind}:${path}`)}: v${index},`),
    '}',
    '',
    '/** 按 OpenAPI 路径模板校验 CLI 提交的请求体或查询参数。 */',
    'export function validateInput(kind, path, value) {',
    '  return validators[`${kind}:${path}`]?.(value) === true',
    '}',
    '',
  ].join('\n'),
)
await writeFile(
  new URL('input-validators.d.mts', output),
  "export function validateInput(kind: 'body' | 'query', path: string, value: unknown): boolean\n",
)

process.stdout.write('已生成接口类型与 CLI 输入校验器。\n')
