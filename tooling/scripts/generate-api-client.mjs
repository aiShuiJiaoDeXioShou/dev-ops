import { mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import openapiTS, { astToString } from 'openapi-typescript'
import { Ajv } from 'ajv'
import standaloneCode from 'ajv/dist/standalone/index.js'

const input = new URL('../../.artifacts/openapi.json', import.meta.url)
const output = new URL('../../packages/api-client/src/generated/', import.meta.url)
const document = JSON.parse(await readFile(input, 'utf8'))
const schemas = document.components?.schemas
const health = document.paths?.['/api/v1/health']?.get?.responses?.['200']?.content?.['application/json']?.schema
const readiness = document.paths?.['/api/v1/ready']?.get?.responses?.['200']?.content?.['application/json']?.schema
const error = document.paths?.['/api/v1/ready']?.get?.responses?.['503']?.content?.['application/json']?.schema
if (!schemas || !health || !readiness || !error) {
  throw new Error('OpenAPI 缺少现有健康检查契约，请核对路由和响应定义。')
}
await rm(output, { recursive: true, force: true })
await mkdir(output, { recursive: true })
await writeFile(new URL('api.ts', output), astToString(await openapiTS(input)))
const validator = new Ajv({ code: { source: true, esm: true } })
for (const [name, schema] of Object.entries(schemas)) {
  validator.addSchema(schema, `#/components/schemas/${name}`)
}
for (const [name, schema, path, status] of [
  ['health', health, '/api/v1/health', 200],
  ['readiness', readiness, '/api/v1/ready', 200],
  ['error', error, '/api/v1/ready', 503],
]) {
  const validate = validator.compile(schema)
  const source = standaloneCode(validator, validate)
  // 浏览器仅使用预编译校验器；新增 schema 需要辅助运行库时须先明确对应依赖。
  if (/\brequire\(/.test(source)) throw new Error(`校验器 ${name} 需要额外运行库，请先配置浏览器兼容的生成方式。`)
  await writeFile(new URL(`${name}.mjs`, output), source)
  await writeFile(new URL(`${name}.d.mts`, output), [
    "import type { paths } from './api.js'",
    '/** 根据后端契约校验未知响应，通过时收窄类型。 */',
    `export default function validate(value: unknown): value is paths['${path}']['get']['responses'][${status}]['content']['application/json']`,
    '',
  ].join('\n'))
}
process.stdout.write('已生成接口类型与独立响应校验器。\n')
