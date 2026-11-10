import { Type } from 'typebox'
import { Value } from 'typebox/value'
import {
  hasUniqueStepIndexes,
  PipelineEnvSchema,
  PipelineInputsSchema,
  RunPlanJobSchema,
  type PipelineRunStatus,
  type PipelineStepStatus,
} from '@dev-ops/pipeline-protocol'
import type { RunPlanTemplate } from './pipeline.planner.ts'

/** 运行状态白名单；与 data-model.md 第 4.1 节及数据库 CHECK 约束一致。 */
export const PIPELINE_RUN_STATUSES: readonly PipelineRunStatus[] = [
  'queued',
  'assigned',
  'running',
  'cancelling',
  'succeeded',
  'failed',
  'cancelled',
  'interrupted',
]

/** 运行终态；进入后不可再转换，重跑必须创建新运行。 */
export const PIPELINE_TERMINAL_RUN_STATUSES: readonly PipelineRunStatus[] = [
  'succeeded',
  'failed',
  'cancelled',
  'interrupted',
]

/** 步骤状态白名单；与 data-model.md 第 4.2 节一致。 */
export const PIPELINE_STEP_STATUSES: readonly PipelineStepStatus[] = [
  'pending',
  'running',
  'succeeded',
  'failed',
  'skipped',
  'cancelled',
]

const RUN_STATUS_SET: ReadonlySet<string> = new Set(PIPELINE_RUN_STATUSES)
const STEP_STATUS_SET: ReadonlySet<string> = new Set(PIPELINE_STEP_STATUSES)

/** 运行状态允许的下一步；取消与超时只能按表逐步收口，不允许跳跃启动。 */
const RUN_TRANSITIONS: Record<PipelineRunStatus, readonly PipelineRunStatus[]> = {
  queued: ['assigned', 'cancelled', 'interrupted'],
  assigned: ['running', 'cancelled', 'interrupted', 'failed'],
  running: ['cancelling', 'succeeded', 'failed', 'interrupted'],
  cancelling: ['cancelled', 'failed', 'interrupted'],
  succeeded: [],
  failed: [],
  cancelled: [],
  interrupted: [],
}

/** 步骤状态允许的下一步；步骤没有 interrupted，运行中断时以 cancelled/skipped 收口。 */
const STEP_TRANSITIONS: Record<PipelineStepStatus, readonly PipelineStepStatus[]> = {
  pending: ['running', 'skipped', 'failed', 'cancelled'],
  running: ['succeeded', 'failed', 'cancelled'],
  succeeded: [],
  failed: [],
  skipped: [],
  cancelled: [],
}

/** 判断字符串是否为运行状态；用于把数据库 text 收窄为业务状态。 */
export function isPipelineRunStatus(value: string): value is PipelineRunStatus {
  return RUN_STATUS_SET.has(value)
}

/** 判断字符串是否为步骤状态。 */
export function isPipelineStepStatus(value: string): value is PipelineStepStatus {
  return STEP_STATUS_SET.has(value)
}

/** 判断运行是否已进入终态。 */
export function isTerminalRunStatus(value: string): boolean {
  return isPipelineRunStatus(value) && PIPELINE_TERMINAL_RUN_STATUSES.includes(value)
}

/**
 * 判断运行状态转换是否合法；相同状态返回 true，便于幂等收口，但仍需调用方条件更新。
 * @param from 当前状态（数据库 text）。
 * @param to 目标状态。
 * @throws 当前状态不在白名单时抛出普通 Error，表示数据库数据异常而非用户输入错误。
 */
export function canTransitionRunStatus(from: string, to: PipelineRunStatus): boolean {
  if (!isPipelineRunStatus(from)) throw new Error(`数据库运行状态不合法: ${from}`)
  return from === to || RUN_TRANSITIONS[from].includes(to)
}

/**
 * 判断步骤状态转换是否合法；相同状态返回 true，由 service 按重复上报幂等处理。
 * @throws 当前状态不在白名单时抛出普通 Error，表示数据库数据异常。
 */
export function canTransitionStepStatus(from: string, to: PipelineStepStatus): boolean {
  if (!isPipelineStepStatus(from)) throw new Error(`数据库步骤状态不合法: ${from}`)
  return from === to || STEP_TRANSITIONS[from].includes(to)
}

/** 运行计划模板 TypeBox 校验；只用于读取数据库快照，不接受外部请求直接输入。 */
const RunPlanTemplateSchema = Type.Object({
  runId: Type.String({ minLength: 1, maxLength: 64 }),
  workflowPath: Type.String({ minLength: 1, maxLength: 500 }),
  workflowName: Type.String({ minLength: 1, maxLength: 120 }),
  ref: Type.String({ minLength: 1, maxLength: 300 }),
  commitSha: Type.String({ pattern: '^[0-9a-f]{7,64}$' }),
  repository: Type.String({ minLength: 1, maxLength: 500 }),
  timeoutSeconds: Type.Integer({ minimum: 1, maximum: 86_400 }),
  inputs: PipelineInputsSchema,
  env: PipelineEnvSchema,
  secretNames: Type.Array(Type.String({ maxLength: 128 }), { maxItems: 100 }),
  jobs: Type.Array(RunPlanJobSchema, { minItems: 1, maxItems: 50 }),
})

/**
 * 把数据库中的运行计划快照解析为模板。
 * @param value 数据库 jsonb 字段值。
 * @returns 已校验的运行计划模板。
 * @throws 结构不符合模板时抛出普通 Error，表示持久化数据异常。
 */
export function parseRunPlanTemplate(value: unknown): RunPlanTemplate {
  if (!Value.Check(RunPlanTemplateSchema, value)) {
    throw new Error('数据库运行计划快照不合法')
  }
  if (!hasUniqueStepIndexes(value)) {
    throw new Error('数据库运行计划步骤序号重复')
  }
  return value
}

/**
 * 计算运行计划所需的节点能力标签（各 job runs-on 的并集）。
 * @param template 运行计划模板。
 * @returns 去重排序后的能力标签；节点必须包含全部标签才可领取。
 */
export function collectRunRequirements(template: RunPlanTemplate): string[] {
  const required = new Set<string>()
  for (const job of template.jobs) {
    for (const capability of job.runsOn) required.add(capability)
  }
  return [...required].sort()
}

/**
 * 判断节点能力是否满足运行要求。
 * @param nodeCapabilities 节点上报并被管理员确认的能力标签。
 * @param required 运行计划要求的标签。
 * @returns 节点包含全部要求标签时为 true。
 */
export function nodeSatisfiesRequirements(nodeCapabilities: string[], required: string[]): boolean {
  if (required.length === 0) return false
  const owned = new Set(nodeCapabilities)
  return required.every((capability) => owned.has(capability))
}

/**
 * 把触发输入收敛为可持久化、可展示的键值对；密钥类字段名不保存明文。
 * @param inputs 手动触发输入。
 * @param maskValue 单值脱敏函数，由调用方注入以避免状态模块依赖脱敏规则。
 * @returns 输入摘要；响应中只用于展示，不参与执行。
 */
export function toInputSummary(
  inputs: Record<string, unknown>,
  maskValue: (name: string, value: string) => string,
): Record<string, string | number | boolean | null> {
  const summary: Record<string, string | number | boolean | null> = {}
  for (const [name, value] of Object.entries(inputs).slice(0, 50)) {
    if (typeof value === 'string') summary[name] = maskValue(name, value)
    else if (typeof value === 'number' || typeof value === 'boolean') summary[name] = value
    else if (value === null) summary[name] = null
    else summary[name] = null
  }
  return summary
}
