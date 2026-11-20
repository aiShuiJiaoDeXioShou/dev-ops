import { createIdempotencyKey, type ApiBody, type ApiQuery, type paths } from '@dev-ops/api-client'
import { isApiBody, isApiQuery } from '@dev-ops/api-client/input'
import type { Command } from 'commander'
import {
  businessContext,
  printBusinessResult,
  readContent,
  resolveTeamId,
  type BusinessCommandContext,
} from './command.ts'
import { confirmDangerous } from './confirm.ts'
import type { CliContext } from './context.ts'
import { resolvePagination } from './config.ts'
import { CliError } from './errors.ts'

type CommandResult<T> = { data: T; requestId: string }
type Page<T> = { items: T[]; page: number; pageSize: number; total: number }

interface Invocation {
  business: BusinessCommandContext
  arg: (index?: number) => string
  team: () => Promise<string>
}

async function invocation(command: Command, context: CliContext): Promise<Invocation> {
  const business = await businessContext(command, context)
  return {
    business,
    arg: (index = 0) => {
      const value: unknown = command.processedArgs[index]
      if (typeof value !== 'string' || !value.trim()) throw new CliError('缺少有效的资源标识', 2)
      return value
    },
    team: () => resolveTeamId(context, business),
  }
}

/**
 * 读取 JSON 文件；标准输入只能分配给 Token 或业务数据其中之一。
 * @param file 文件路径，或表示标准输入的 -。
 * @param command 当前命令，用于检查全局选项。
 * @param context CLI 输入通道。
 * @returns 解析后的未知数据，调用者须校验结构。
 * @throws 文件不可读、JSON 无效或标准输入被重复使用时抛出参数错误。
 */
export async function readJsonFile(file: string, command: Command, context: CliContext): Promise<unknown> {
  if (file === '-' && command.optsWithGlobals().tokenStdin) {
    throw new CliError('标准输入只能用于 Token 或请求内容其中之一', 2, { code: 'STDIN_CONFLICT' })
  }
  const content = await readContent(file, context)
  try {
    const value: unknown = JSON.parse(content)
    return value
  } catch {
    throw new CliError('输入内容必须是有效 JSON', 2, { code: 'INVALID_JSON' })
  }
}

/**
 * 按生成契约验证请求体；错误只显示接口模板，避免泄露输入值。
 * @param path OpenAPI 路径模板。
 * @param body 未知 JSON 值。
 * @returns 已校验的请求体。
 * @throws 不符合契约时抛出参数错误。
 */
export function checkedBody<P extends keyof paths>(path: P, body: unknown): ApiBody<P, 'post'> {
  if (!isApiBody(path, body)) {
    throw new CliError(`请求内容不符合 POST ${path} 的接口契约`, 2, { code: 'INVALID_INPUT' })
  }
  return body
}

/**
 * 按生成契约验证筛选条件。
 * @param path OpenAPI 路径模板。
 * @param query 查询条件。
 * @returns 已校验的查询参数。
 * @throws 未知或不合法的参数抛出用法错误。
 */
export function checkedQuery<P extends keyof paths>(path: P, query: unknown): ApiQuery<P, 'get'> {
  if (!isApiQuery(path, query)) {
    throw new CliError(`筛选条件不符合 GET ${path} 的接口契约`, 2, { code: 'INVALID_INPUT' })
  }
  return query
}

async function confirmAction(command: Command, message: string | undefined): Promise<void> {
  if (!message) return
  const { yes, json } = command.optsWithGlobals()
  await confirmDangerous({ yes: yes === true, json: json === true, message })
}

/**
 * 注册 API 命令，集中处理身份、确认、输出和标准退出语义。
 * @param command 已定义参数和说明的 Commander 命令。
 * @param context CLI 执行上下文。
 * @param run 调用业务客户端；参数索引从零起。
 * @param options 可选的危险操作确认、列表归一化及跟踪命令输出规则。
 * @returns 无返回值，注册时不读取配置或请求服务。
 */
export function apiAction(
  command: Command,
  context: CliContext,
  run: (input: Invocation) => Promise<CommandResult<unknown>>,
  options: { confirm?: string; list?: boolean; silentWhenFollowing?: boolean } = {},
): void {
  command.action(async () => {
    await confirmAction(command, options.confirm)
    const input = await invocation(command, context)
    const result = await run(input)
    if (!options.silentWhenFollowing || command.opts().follow !== true) {
      printBusinessResult(context, input.business.globals, result, options.list)
    }
  })
}

/**
 * 注册从文件读取结构化业务请求的命令。
 * @param command 已定义位置参数的命令。
 * @param context CLI 执行上下文。
 * @param path 权威请求体所在的 OpenAPI 路径模板。
 * @param run 将校验后的请求交给指定业务客户端方法。
 * @param options 可选的确认、敏感输入和幂等设置。
 * @returns 无返回值，JSON 无效或标准输入冲突时不会执行写请求。
 */
export function jsonAction<P extends keyof paths>(
  command: Command,
  context: CliContext,
  path: P,
  run: (
    input: Invocation,
    body: ApiBody<P, 'post'>,
    write: { idempotencyKey?: string },
  ) => Promise<CommandResult<unknown>>,
  options: { confirm?: string; secret?: boolean; secretFields?: readonly string[]; idempotent?: boolean } = {},
): void {
  command.requiredOption(
    '--file <path>',
    options.secret ? '敏感 JSON 输入，使用 - 从标准输入读取' : 'JSON 文件，- 表示标准输入',
  )
  command.addHelpText(
    'after',
    `
请求体契约 POST ${path}
`,
  )
  command.action(async () => {
    await confirmAction(command, options.confirm)
    const { file } = command.opts<{ file: string }>()
    if (options.secret && file !== '-') throw new CliError('敏感输入请通过 --file - 从标准输入读取', 2)
    const body = checkedBody(path, await readJsonFile(file, command, context))
    const includesSecret =
      options.secret ||
      (options.secretFields &&
        typeof body === 'object' &&
        body !== null &&
        options.secretFields.some((key) => Object.hasOwn(body, key)))
    if (includesSecret && file !== '-') throw new CliError('敏感输入请通过 --file - 从标准输入读取', 2)
    const input = await invocation(command, context)
    const write = options.idempotent === false || includesSecret ? {} : writeOptions(input.business)
    const result = await run(input, body, write)
    printBusinessResult(context, input.business.globals, result)
  })
}

/**
 * 创建普通写操作的幂等选项。
 * @param business 认证上下文和全局选项。
 * @returns 调用方提供的幂等键或新 UUID。
 */
export function writeOptions(business: BusinessCommandContext): { idempotencyKey: string } {
  return { idempotencyKey: business.globals.idempotencyKey ?? createIdempotencyKey() }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * 注册带页码或游标的只读查询，以及由 API 契约定义的筛选条件。
 * @param command 已定义参数的命令。
 * @param context CLI 执行上下文。
 * @param path 查询契约的 OpenAPI 路径模板。
 * @param read 调用对应的共享客户端。
 * @param guard 可选的分页模式，游标由服务端原样返回。
 * @returns 无返回值；服务端分页异常或超过上限会失败而非返回部分成功。
 */
export function queryAction<P extends keyof paths>(
  command: Command,
  context: CliContext,
  path: P,
  read: (input: Invocation, query: ApiQuery<P, 'get'>) => Promise<CommandResult<unknown>>,
  guard: 'page' | 'nextCursor' | 'nextBefore' | 'nextBotCursor' | undefined = undefined,
): void {
  command.option('--query-file <path>', '筛选条件 JSON，键名沿用 API 契约；- 表示标准输入')
  command.addHelpText(
    'after',
    `
筛选契约 GET ${path}
`,
  )
  if (guard && guard !== 'page') command.option('--cursor <value>', '从服务端返回的游标继续')
  apiAction(command, context, async (input) => {
    const { queryFile, cursor } = command.opts<{ queryFile?: string; cursor?: string }>()
    const filters = queryFile ? await readJsonFile(queryFile, command, context) : {}
    if (!isObject(filters)) throw new CliError('筛选条件必须是 JSON 对象', 2, { code: 'INVALID_INPUT' })
    const fetchPage = (params: Record<string, unknown>) => read(input, checkedQuery(path, params))
    if (!guard) return fetchPage(filters)
    if (guard === 'page') {
      if ('page' in filters || 'pageSize' in filters) throw new CliError('分页请通过 --page 与 --page-size 指定', 2)
      const { page, pageSize, all } = resolvePagination(input.business.globals)
      const params = { ...filters, page, pageSize }
      if (!all) return fetchPage(params)
      const items: unknown[] = []
      for (let next = 1; next <= 1000; next += 1) {
        const result = await fetchPage({ ...params, page: next })
        const payload = result.data
        if (!isPage(payload)) throw new CliError('服务端分页响应无效', 1, { code: 'INVALID_RESPONSE' })
        items.push(...payload.items)
        if (items.length >= payload.total) {
          return { data: { items, page: 1, pageSize: items.length, total: payload.total }, requestId: result.requestId }
        }
        if (!payload.items.length) break
      }
      throw new CliError('未能读取全部分页结果，请缩小筛选范围', 1, { code: 'INCOMPLETE_PAGINATION' })
    }
    const { all, page, pageSize } = input.business.globals
    if (page !== undefined || pageSize !== undefined) throw new CliError('此列表使用 --cursor 游标分页', 2)
    const cursorKeys = { nextCursor: 'cursor', nextBefore: 'before', nextBotCursor: 'botCursor' }
    const key = cursorKeys[guard]
    const itemsKey = guard === 'nextBotCursor' ? 'byBot' : 'items'
    let next: unknown = cursor ?? filters[key]
    if (!all) return fetchPage({ ...filters, ...(next === undefined ? {} : { [key]: next }) })
    const items: unknown[] = []
    const visited = new Set<unknown>()
    for (let count = 0; count < 1000 && !visited.has(next); count += 1) {
      visited.add(next)
      const result = await fetchPage({ ...filters, ...(next === undefined ? {} : { [key]: next }) })
      const payload = result.data
      if (!isObject(payload)) throw new CliError('服务端游标响应无效', 1, { code: 'INVALID_RESPONSE' })
      const pageItems = payload[itemsKey]
      if (!Array.isArray(pageItems)) throw new CliError('服务端游标响应无效', 1, { code: 'INVALID_RESPONSE' })
      items.push(...pageItems)
      next = payload[guard]
      if (next === null) return { data: { ...payload, [itemsKey]: items }, requestId: result.requestId }
      if (typeof next !== 'string' || !next) break
    }
    throw new CliError('未能读取全部游标结果，请缩小筛选范围', 1, { code: 'INCOMPLETE_PAGINATION' })
  })
}

function isPage(value: unknown): value is Page<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'items' in value &&
    Array.isArray(value.items) &&
    'total' in value &&
    typeof value.total === 'number'
  )
}

/**
 * 收集可重复的 CLI 标识选项，保留用户指定的次序。
 * @param value 当前参数值。
 * @param values 前面各次给出的值。
 * @returns 含本次参数的新数组。
 */
export function collectValues(value: string, values: string[]): string[] {
  return [...values, value]
}

/**
 * 解析完整列表替换或显式清空。
 * @param values 重复选项传入的完整列表。
 * @param clear 是否显式清空。
 * @param name 可重复选项的名称。
 * @returns 保持现状时返回 undefined，清空时返回空数组。
 * @throws 同时指定替换和清空时抛出参数错误。
 */
export function listChange(
  values: string[] | undefined,
  clear: boolean | undefined,
  name: string,
): string[] | undefined {
  if (!values?.length) return clear ? [] : undefined
  if (clear) throw new CliError(`不能同时指定 ${name} 和清空操作`, 2, { code: 'INVALID_OPTION' })
  return values
}
