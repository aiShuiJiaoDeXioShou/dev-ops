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
const health = document.paths?.['/api/v1/health']?.get?.responses?.['200']?.content?.['application/json']?.schema
const readiness = document.paths?.['/api/v1/ready']?.get?.responses?.['200']?.content?.['application/json']?.schema
const errorEntry = Object.entries(schemas ?? {}).find(([, schema]) => schema?.title === 'ErrorResponse')
const error = errorEntry?.[1]
const errorSchemaKey = errorEntry?.[0]
if (!schemas || !health || !readiness || !error) {
  throw new Error('OpenAPI 缺少现有健康检查契约，请核对路由和响应定义。')
}
await rm(output, { recursive: true, force: true })
await mkdir(output, { recursive: true })
const filteredInput = new URL('../../.artifacts/openapi.client.json', import.meta.url)
await writeFile(filteredInput, JSON.stringify(document))
await writeFile(new URL('api.ts', output), astToString(await openapiTS(filteredInput)))
await rm(filteredInput, { force: true })
const validator = new Ajv({ code: { source: true, esm: true } })
for (const [name, schema] of Object.entries(schemas)) {
  validator.addSchema(schema, `#/components/schemas/${name}`)
}
for (const [name, schema, typeExpression] of [
  ['health', health, "paths['/api/v1/health']['get']['responses'][200]['content']['application/json']"],
  ['readiness', readiness, "paths['/api/v1/ready']['get']['responses'][200]['content']['application/json']"],
  ['error', error, `components['schemas']['${errorSchemaKey}']`],
]) {
  const validate = validator.compile(schema)
  const source = standaloneCode(validator, validate)
  // 浏览器仅使用预编译校验器；新增 schema 需要辅助运行库时须先明确对应依赖。
  if (/\brequire\(/.test(source)) throw new Error(`校验器 ${name} 需要额外运行库，请先配置浏览器兼容的生成方式。`)
  await writeFile(new URL(`${name}.mjs`, output), source)
  const typeImport =
    name === 'error' ? "import type { components } from './api.js'" : "import type { paths } from './api.js'"
  await writeFile(
    new URL(`${name}.d.mts`, output),
    [
      typeImport,
      '/** 根据后端契约校验未知响应，通过时收窄类型。 */',
      `export default function validate(value: unknown): value is ${typeExpression}`,
      '',
    ].join('\n'),
  )
}

// 为每个业务操作生成 200 响应校验器；客户端按方法 + 路径模板选择校验器，
// 运行时只加载预编译 ESM，不把 Ajv 或编译器带入浏览器/CLI。
function escapePattern(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function pathPattern(path) {
  return `^${path
    .split('/')
    .map((segment) => (/^\{[^}]+\}$/.test(segment) ? '[^/]+' : escapePattern(segment)))
    .join('/')}$`
}

const operations = []
let operationIndex = 0
for (const [path, item] of Object.entries(document.paths ?? {})) {
  if (path.startsWith('/api/v1/auth/')) continue
  for (const method of ['get', 'post']) {
    const schema = item?.[method]?.responses?.['200']?.content?.['application/json']?.schema
    if (!schema) continue
    const validate = validator.compile(schema)
    const source = standaloneCode(validator, validate)
    if (/\brequire\(/.test(source)) {
      throw new Error(`响应校验器 ${method.toUpperCase()} ${path} 需要额外运行库，请先完善生成配置`)
    }
    const fileName = `response-${String(operationIndex).padStart(3, '0')}.mjs`
    await writeFile(new URL(fileName, output), source)
    await writeFile(
      new URL(fileName.replace(/\.mjs$/, '.d.mts'), output),
      [
        '/** 根据后端 OpenAPI 响应契约校验未知数据。 */',
        'export default function validate(value: unknown): boolean',
        '',
      ].join('\n'),
    )
    operations.push({ method: method.toUpperCase(), path, pattern: pathPattern(path), fileName })
    operationIndex += 1
  }
}

const registryName = 'response-validators.mjs'
const imports = operations.map((operation, index) => `import v${index} from './${operation.fileName}'`).join('\n')
const entries = operations
  .map(
    (operation, index) =>
      `  { method: '${operation.method}', path: '${operation.path}', pattern: new RegExp(${JSON.stringify(operation.pattern)}), validate: v${index} },`,
  )
  .join('\n')
await writeFile(
  new URL(registryName, output),
  [
    '// 业务响应校验器注册表；由 generate-api-client.mjs 生成，不手工修改。',
    imports,
    '',
    'const validators = [',
    entries,
    ']',
    '',
    '/** 按 HTTP 方法与路径模板校验完整响应信封；没有匹配项时不额外限制。 */',
    'export function validateResponse(method, path, payload) {',
    "  const pathname = path.split('?')[0]",
    '  const found = validators.find((entry) => entry.method === method && entry.pattern.test(pathname))',
    '  return found === undefined ? true : found.validate(payload)',
    '}',
    '',
  ].join('\n'),
)
await writeFile(
  new URL('response-validators.d.mts', output),
  [
    '/** 按 HTTP 方法与路径模板校验完整响应信封；没有匹配项时不额外限制。 */',
    'export function validateResponse(method: string, path: string, payload: unknown): boolean',
    '',
  ].join('\n'),
)

process.stdout.write('已生成接口类型与独立响应校验器。\n')

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
