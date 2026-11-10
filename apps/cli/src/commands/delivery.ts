import type { Command } from 'commander'
import type { ApiBody, ApiQuery } from '@dev-ops/api-client'
import { businessContext, printBusinessResult, readContent } from '../lib/command.ts'
import { resolvePagination } from '../lib/config.ts'
import { CliError } from '../lib/errors.ts'
import type { CliContext } from '../lib/context.ts'

type ReportBuildBody = ApiBody<'/api/v1/projects/{projectId}/builds', 'post'>
type ListBuildsQuery = ApiQuery<'/api/v1/projects/{projectId}/builds', 'get'>

/**
 * 从用户输入中取值并校验枚举；未提供返回 undefined。
 * @param value 用户输入。
 * @param allowed 允许值。
 * @param name 参数名，用于错误说明。
 * @returns 通过校验的值或 undefined。
 * @throws 值不在白名单时抛出参数错误。
 */
function parseEnum<T extends readonly string[]>(
  value: string | undefined,
  allowed: T,
  name: string,
): T[number] | undefined {
  if (value === undefined) return undefined
  if (!(allowed as readonly string[]).includes(value)) {
    throw new CliError(`${name} 取值不合法，可选：${allowed.join('|')}`, 2, { code: 'INVALID_OPTION' })
  }
  return value as T[number]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requireStringField(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new CliError(`构建上报缺少字符串字段 ${name}`, 2, { code: 'INVALID_BUILD_REPORT' })
  }
  return value
}

/**
 * 校验上报 JSON 的必填骨架；完整业务校验仍由服务端执行。
 * @param value 解析后的 JSON。
 * @returns 通过骨架校验的上报体。
 * @throws 不是对象或缺少必填字段时抛出参数错误。
 */
function parseReportBody(value: unknown): ReportBuildBody {
  if (!isRecord(value)) throw new CliError('构建上报内容必须是 JSON 对象', 2, { code: 'INVALID_BUILD_REPORT' })
  requireStringField(value.buildKey, 'buildKey')
  requireStringField(value.versionLabel, 'versionLabel')
  requireStringField(value.source, 'source')
  requireStringField(value.collectedAt, 'collectedAt')
  requireStringField(value.resultStatus, 'resultStatus')
  if (value.artifacts !== undefined && !Array.isArray(value.artifacts)) {
    throw new CliError('artifacts 必须是数组', 2, { code: 'INVALID_BUILD_REPORT' })
  }
  if (value.targets !== undefined && !Array.isArray(value.targets)) {
    throw new CliError('targets 必须是数组', 2, { code: 'INVALID_BUILD_REPORT' })
  }
  return value as ReportBuildBody
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    throw new CliError('构建上报文件不是有效 JSON', 2, { code: 'INVALID_JSON' })
  }
}

export function registerDeliveryCommands(program: Command, context: CliContext): void {
  const delivery = program.command('delivery').description('上报与查询构建、产物引用')

  delivery
    .command('report')
    .description('从 JSON 文件或标准输入上报一次构建与产物引用')
    .requiredOption('--project <projectId>', '目标项目标识')
    .requiredOption('--file <path>', '构建上报 JSON 文件；使用 - 从标准输入读取')
    .action(async (options: { project: string; file: string }, command: Command) => {
      const business = await businessContext(command, context)
      const body = parseReportBody(parseJson(await readContent(options.file, context)))
      const result = await business.client.reportBuild(options.project, body, {
        ...(business.globals.idempotencyKey ? { idempotencyKey: business.globals.idempotencyKey } : {}),
      })
      printBusinessResult(context, business.globals, result)
    })

  delivery
    .command('list')
    .description('查询项目构建记录列表')
    .requiredOption('--project <projectId>', '目标项目标识')
    .option('--service <serviceId>', '按服务筛选')
    .option('--environment <environment>', '按环境筛选：development|test|production')
    .option('--source <source>', '按来源筛选：pipeline|local|external_system|manual')
    .option('--result-status <status>', '按结果筛选：succeeded|failed|cancelled|unknown')
    .action(async (options: Record<string, string | undefined>, command: Command) => {
      const business = await businessContext(command, context)
      const { page, pageSize } = resolvePagination(business.globals)
      const environment = parseEnum(
        options.environment,
        ['development', 'test', 'production'] as const,
        '--environment',
      )
      const source = parseEnum(options.source, ['pipeline', 'local', 'external_system', 'manual'] as const, '--source')
      const resultStatus = parseEnum(
        options.resultStatus,
        ['succeeded', 'failed', 'cancelled', 'unknown'] as const,
        '--result-status',
      )
      const query: ListBuildsQuery = {
        ...(options.service ? { serviceId: options.service } : {}),
        ...(environment ? { environment } : {}),
        ...(source ? { source } : {}),
        ...(resultStatus ? { resultStatus } : {}),
        page,
        pageSize,
      }
      const result = await business.client.listBuilds(options.project ?? '', query)
      printBusinessResult(context, business.globals, result, true)
    })

  delivery
    .command('get')
    .description('查询构建记录详情')
    .argument('<buildId>', '构建记录标识')
    .action(async (buildId: string, _options: unknown, command: Command) => {
      const business = await businessContext(command, context)
      const result = await business.client.getBuild(buildId)
      printBusinessResult(context, business.globals, result)
    })
}
