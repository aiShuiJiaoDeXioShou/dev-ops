import type { ApiBody, ApiQuery } from '@dev-ops/api-client'
import { createIdempotencyKey } from '@dev-ops/api-client'
import { Command } from 'commander'
import { businessContext, collectAllPages, printBusinessResult, resolveTeamId } from '../lib/command.ts'
import { resolvePagination } from '../lib/config.ts'
import type { CliContext } from '../lib/context.ts'
import { confirmDangerous } from '../lib/confirm.ts'
import { CliError } from '../lib/errors.ts'

const OPERATION_KINDS = ['deploy_version', 'database_change', 'server_cleanup', 'cloud_resource_change'] as const
const ENVIRONMENTS = ['development', 'test', 'production'] as const
const EXECUTION_MODES = ['platform_pipeline', 'external_system'] as const
const PLAN_STATUSES = ['pending', 'approved', 'executing', 'verifying', 'completed', 'failed', 'cancelled'] as const

type CreatePlanBody = ApiBody<'/api/v1/projects/{projectId}/change-plans', 'post'>
type UpdatePlanBody = ApiBody<'/api/v1/change-plans/{planId}/update', 'post'>
type ListPlansQuery = ApiQuery<'/api/v1/teams/{teamId}/change-plans', 'get'>
type ApprovePlanBody = ApiBody<'/api/v1/change-plans/{planId}/approve', 'post'>
type ExecutePlanBody = ApiBody<'/api/v1/change-plans/{planId}/execute', 'post'>
type VerifyPlanBody = ApiBody<'/api/v1/change-plans/{planId}/verify', 'post'>
type CancelPlanBody = ApiBody<'/api/v1/change-plans/{planId}/cancel', 'post'>
type RetryPlanBody = ApiBody<'/api/v1/change-plans/{planId}/retry', 'post'>

interface PlanFieldsOptions {
  kind?: string
  environment?: string
  service?: string
  target: string
  versionLabel: string
  scope: string
  evidence: string
  rollback: string
  execution?: string
  workflow?: string
  workflowRef?: string
}

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

function requireEnum<T extends readonly string[]>(value: string | undefined, allowed: T, name: string): T[number] {
  const parsed = parseEnum(value, allowed, name)
  if (parsed === undefined) throw new CliError(`缺少参数 --${name}`, 2, { code: 'MISSING_OPTION' })
  return parsed
}

function requireRevision(value: number | undefined): number {
  if (value === undefined || !Number.isSafeInteger(value) || value < 1) {
    throw new CliError('--revision 必须是大于 0 的整数', 2, { code: 'INVALID_REVISION' })
  }
  return value
}

function buildPlanFields(options: PlanFieldsOptions): CreatePlanBody {
  const operationKind = requireEnum(options.kind, OPERATION_KINDS, 'kind')
  const environment = requireEnum(options.environment, ENVIRONMENTS, 'environment')
  const executionMode = requireEnum(options.execution, EXECUTION_MODES, 'execution')
  if (executionMode === 'platform_pipeline' && !options.workflow?.trim()) {
    throw new CliError('platform_pipeline 执行方式需要 --workflow <path>', 2, { code: 'MISSING_WORKFLOW' })
  }
  return {
    operationKind,
    environment,
    serviceId: options.service ?? null,
    targetResource: options.target,
    versionLabel: options.versionLabel,
    scopeSummary: options.scope,
    evidence: options.evidence,
    rollbackPlan: options.rollback,
    executionMode,
    workflowPath: options.workflow ?? null,
    workflowRef: options.workflowRef ?? null,
  }
}

function applyPlanOptions(command: Command): Command {
  return command
    .requiredOption('--kind <kind>', '操作类型：deploy_version|database_change|server_cleanup|cloud_resource_change')
    .requiredOption('--environment <environment>', '目标环境：development|test|production')
    .option('--service <serviceId>', '部署类必填：目标服务标识')
    .requiredOption('--target <target>', '目标服务或资源标识')
    .requiredOption('--version-label <version>', '版本或迁移标识；避免与全局 --version 冲突')
    .requiredOption('--scope <scope>', '变更范围，必须具体到本次版本/环境/资源')
    .requiredOption('--evidence <evidence>', '核对依据')
    .requiredOption('--rollback <rollback>', '恢复方案')
    .requiredOption('--execution <mode>', '执行方式：platform_pipeline|external_system')
    .option('--workflow <path>', '部署工作流路径（platform_pipeline 必填）')
    .option('--workflow-ref <ref>', '部署工作流所在分支或标签')
}

/**
 * 注册变更计划命令组。
 * @param program 根命令。
 * @param context CLI 上下文。
 */
/** 校验 ISO 8601 时间并在本地拒绝非法值，避免把坏参数发送到服务端。 */
function requireIsoTimestamp(value: string, label: string): string {
  const timestamp = Date.parse(value)
  if (Number.isNaN(timestamp)) {
    throw new CliError(`${label} 必须是 ISO 8601 时间，例如 2026-11-11T00:00:00Z`, 2, { code: 'INVALID_ARGUMENT' })
  }
  return new Date(timestamp).toISOString()
}

export function registerChangeCommands(program: Command, context: CliContext): void {
  const change = program.command('change').description('创建、放行、执行与验证变更计划')

  applyPlanOptions(
    change.command('create').description('创建变更计划').requiredOption('--project <projectId>', '目标项目标识'),
  ).action(async (options: PlanFieldsOptions & { project: string }, command: Command) => {
    const business = await businessContext(command, context)
    const result = await business.client.createChangePlan(options.project, buildPlanFields(options), {
      idempotencyKey: business.globals.idempotencyKey ?? createIdempotencyKey(),
    })
    printBusinessResult(context, business.globals, result)
  })

  change
    .command('list')
    .description('查询团队变更计划列表')
    .option('--project <projectId>', '按项目筛选')
    .option('--environment <environment>', '按环境筛选')
    .option('--status <status>', '按状态筛选')
    .option('--kind <kind>', '按操作类型筛选')
    .option('--from <iso>', '创建时间下限（ISO 8601）')
    .option('--to <iso>', '创建时间上限（ISO 8601）')
    .action(async (options: Record<string, string | undefined>, command: Command) => {
      const business = await businessContext(command, context)
      const teamId = await resolveTeamId(context, business)
      const pagination = resolvePagination(business.globals)
      const from = options.from ? requireIsoTimestamp(options.from, '--from') : undefined
      const to = options.to ? requireIsoTimestamp(options.to, '--to') : undefined
      const query: ListPlansQuery = {
        page: pagination.page,
        pageSize: pagination.pageSize,
        ...(options.project ? { projectId: options.project } : {}),
        ...(options.environment ? { environment: requireEnum(options.environment, ENVIRONMENTS, 'environment') } : {}),
        ...(options.status ? { status: requireEnum(options.status, PLAN_STATUSES, 'status') } : {}),
        ...(options.kind ? { operationKind: requireEnum(options.kind, OPERATION_KINDS, 'kind') } : {}),
        ...(from ? { from } : {}),
        ...(to ? { to } : {}),
      }
      const result = pagination.all
        ? await collectAllPages((page) => business.client.listChangePlans(teamId, { ...query, page }))
        : await business.client.listChangePlans(teamId, query)
      printBusinessResult(context, business.globals, result, true)
    })

  change
    .command('show')
    .description('读取变更计划详情')
    .argument('<planId>', '变更计划标识')
    .action(async (planId: string, _options: unknown, command: Command) => {
      const business = await businessContext(command, context)
      const result = await business.client.getChangePlan(planId)
      printBusinessResult(context, business.globals, result)
    })

  applyPlanOptions(
    change
      .command('update')
      .description('修改变更计划（仅待确认，需提供当前修订与行版本）')
      .argument('<planId>', '变更计划标识')
      .requiredOption('--revision <n>', '当前计划修订号', Number)
      .requiredOption('--expected-version <n>', '当前行版本（乐观锁）', Number),
  ).action(
    async (
      planId: string,
      options: PlanFieldsOptions & { revision: number; expectedVersion: number },
      command: Command,
    ) => {
      const business = await businessContext(command, context)
      const body: UpdatePlanBody = {
        ...buildPlanFields(options),
        expectedRevision: requireRevision(options.revision),
        expectedVersion: requireRevision(options.expectedVersion),
      }
      const result = await business.client.updateChangePlan(planId, body, {
        idempotencyKey: business.globals.idempotencyKey ?? createIdempotencyKey(),
      })
      printBusinessResult(context, business.globals, result)
    },
  )

  change
    .command('approve')
    .description('放行变更计划')
    .argument('<planId>', '变更计划标识')
    .requiredOption('--revision <n>', '计划当前修订号', Number)
    .option('--note <note>', '放行说明')
    .action(async (planId: string, options: { revision: number; note?: string }, command: Command) => {
      const business = await businessContext(command, context)
      await confirmDangerous({
        yes: business.globals.yes === true,
        json: business.globals.json,
        message: `确认放行变更计划 ${planId}（修订 ${options.revision}）？`,
      })
      const body: ApprovePlanBody = {
        expectedRevision: requireRevision(options.revision),
        note: options.note ?? null,
      }
      const result = await business.client.approveChangePlan(planId, body)
      printBusinessResult(context, business.globals, result)
    })

  change
    .command('execute')
    .description('执行已批准的变更计划')
    .argument('<planId>', '变更计划标识')
    .requiredOption('--revision <n>', '计划当前修订号', Number)
    .action(async (planId: string, options: { revision: number }, command: Command) => {
      const business = await businessContext(command, context)
      await confirmDangerous({
        yes: business.globals.yes === true,
        json: business.globals.json,
        message: `确认执行变更计划 ${planId}（修订 ${options.revision}）？`,
      })
      const body: ExecutePlanBody = { expectedRevision: requireRevision(options.revision) }
      const result = await business.client.executeChangePlan(planId, body)
      printBusinessResult(context, business.globals, result)
    })

  change
    .command('verify')
    .description('验证变更执行结果并更新运行版本')
    .argument('<planId>', '变更计划标识')
    .requiredOption('--revision <n>', '计划当前修订号', Number)
    .option('--note <note>', '人工核对说明（产物缺失时必填）')
    .option('--actual-version <version>', '产物缺失时的实际运行版本')
    .option('--health <status>', '产物缺失时的健康状态：ok|failing|unknown')
    .action(
      async (
        planId: string,
        options: { revision: number; note?: string; actualVersion?: string; health?: string },
        command: Command,
      ) => {
        const business = await businessContext(command, context)
        await confirmDangerous({
          yes: business.globals.yes === true,
          json: business.globals.json,
          message: `确认验证变更计划 ${planId}（修订 ${options.revision}）？`,
        })
        const body: VerifyPlanBody = {
          expectedRevision: requireRevision(options.revision),
          note: options.note ?? null,
          actualVersionLabel: options.actualVersion ?? null,
          healthStatus: options.health
            ? requireEnum(options.health, ['ok', 'failing', 'unknown'] as const, 'health')
            : null,
        }
        const result = await business.client.verifyChangePlan(planId, body)
        printBusinessResult(context, business.globals, result)
      },
    )

  change
    .command('cancel')
    .description('取消变更计划')
    .argument('<planId>', '变更计划标识')
    .requiredOption('--revision <n>', '计划当前修订号', Number)
    .requiredOption('--reason <reason>', '取消原因')
    .action(async (planId: string, options: { revision: number; reason: string }, command: Command) => {
      const business = await businessContext(command, context)
      await confirmDangerous({
        yes: business.globals.yes === true,
        json: business.globals.json,
        message: `确认取消变更计划 ${planId}（修订 ${options.revision}）？`,
      })
      const body: CancelPlanBody = {
        expectedRevision: requireRevision(options.revision),
        reason: options.reason,
      }
      const result = await business.client.cancelChangePlan(planId, body)
      printBusinessResult(context, business.globals, result)
    })

  change
    .command('retry')
    .description('核对后重试失败的计划')
    .argument('<planId>', '变更计划标识')
    .requiredOption('--revision <n>', '计划当前修订号', Number)
    .requiredOption('--reason <reason>', '核对结论，必须说明未生效或已修复')
    .action(async (planId: string, options: { revision: number; reason: string }, command: Command) => {
      const business = await businessContext(command, context)
      await confirmDangerous({
        yes: business.globals.yes === true,
        json: business.globals.json,
        message: `确认重试变更计划 ${planId}（修订 ${options.revision}）？`,
      })
      const body: RetryPlanBody = {
        expectedRevision: requireRevision(options.revision),
        reason: options.reason,
      }
      const result = await business.client.retryChangePlan(planId, body)
      printBusinessResult(context, business.globals, result)
    })

  change
    .command('events')
    .description('分页读取变更计划事件')
    .argument('<planId>', '变更计划标识')
    .action(async (planId: string, _options: unknown, command: Command) => {
      const business = await businessContext(command, context)
      const pagination = resolvePagination(business.globals)
      const result = pagination.all
        ? await collectAllPages((page) =>
            business.client.listChangePlanEvents(planId, { page, pageSize: pagination.pageSize }),
          )
        : await business.client.listChangePlanEvents(planId, {
            page: pagination.page,
            pageSize: pagination.pageSize,
          })
      printBusinessResult(context, business.globals, result, true)
    })

  change
    .command('executions')
    .description('读取变更计划的执行记录')
    .argument('<planId>', '变更计划标识')
    .action(async (planId: string, _options: unknown, command: Command) => {
      const business = await businessContext(command, context)
      const result = await business.client.listChangePlanExecutions(planId)
      printBusinessResult(context, business.globals, result)
    })
}
