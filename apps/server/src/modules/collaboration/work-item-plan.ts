import { Type, type Static } from 'typebox'
import { ERROR_CODES } from '../../platform/http/error-codes.ts'
import { ApiError } from '../../platform/http/errors.ts'

const MAX_PLAN_NODES = 24
const planningDate = Type.Union([Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' }), Type.Null()])
const planFields = {
  id: Type.String({ pattern: '^[a-z0-9_-]{1,36}$' }),
  title: Type.String({ description: '节点或待办名称，最长 120 个字符。' }),
  startsOn: planningDate,
  endsOn: planningDate,
}
const taskSchema = Type.Object({ ...planFields, done: Type.Boolean() }, { additionalProperties: false })
const nodeSchema = Type.Object(
  { ...planFields, tasks: Type.Array(taskSchema, { maxItems: 30 }) },
  { additionalProperties: false },
)

/** 一个事项自己的规划节点。日期为空时仍可维护节点与待办。 */
export const workItemPlanSchema = Type.Array(nodeSchema, {
  maxItems: MAX_PLAN_NODES,
  description: '事项规划节点及待办，日期可为 null。工期使用自然日。',
})
export type WorkItemPlan = Static<typeof workItemPlanSchema>
type PlanEntry = Pick<WorkItemPlan[number], 'id' | 'title' | 'startsOn' | 'endsOn'>

function normalizeEntry<T extends PlanEntry>(entry: T, seen: Set<string>): T {
  const title = entry.title.trim()
  if (title.length === 0 || title.length > 120) {
    throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '节点或任务名称长度必须在 1-120 个字符之间')
  }
  if (seen.has(entry.id)) throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '节点或任务标识重复')
  seen.add(entry.id)
  for (const date of [entry.startsOn, entry.endsOn]) {
    if (date === null) continue
    const parsed = new Date(`${date}T00:00:00.000Z`)
    if (!Number.isFinite(parsed.getTime()) || !parsed.toISOString().startsWith(`${date}T`)) {
      throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '排期日期不合法')
    }
  }
  if (entry.startsOn && entry.endsOn && entry.startsOn > entry.endsOn) {
    throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '结束日期不能早于开始日期')
  }
  return { ...entry, title }
}

/**
 * 校验同一事项内的节点和待办标识、名称和排期。
 * @param plan 已通过接口结构校验的节点及任务。开始或结束日期均可为空。
 * @returns 去除标题首尾空白后的规划。
 * @throws 名称为空、标识重复或日期不合法时抛出业务校验错误。
 */
export function validateWorkItemPlan(plan: WorkItemPlan): WorkItemPlan {
  const nodes = new Set<string>()
  const tasks = new Set<string>()
  return plan.map((node) => ({
    ...normalizeEntry(node, nodes),
    tasks: node.tasks.map((task) => normalizeEntry(task, tasks)),
  }))
}

/** 允许单独维护默认流程的事项类型。 */
export const workItemKindSchema = Type.Union([Type.Literal('requirement'), Type.Literal('bug')])
export type WorkItemKind = Static<typeof workItemKindSchema>

/** 模板复用节点结构。日期和完成情况由每条事项单独维护。 */
export const workItemTemplateSchema = Type.Array(
  Type.Pick(nodeSchema, ['id', 'title'], { additionalProperties: false }),
  { maxItems: MAX_PLAN_NODES },
)
export const workItemTemplatesSchema = Type.Object(
  {
    requirement: Type.Optional(workItemTemplateSchema),
    bug: Type.Optional(workItemTemplateSchema),
  },
  { additionalProperties: false },
)
export type WorkItemTemplate = Static<typeof workItemTemplateSchema>
export type WorkItemTemplates = Static<typeof workItemTemplatesSchema>

const REQUIRED_STAGES: Record<WorkItemKind, readonly string[]> = {
  requirement: ['pending', 'in_development', 'submitted', 'in_testing', 'passed'],
  bug: ['pending', 'in_fix', 'in_regression', 'resolved'],
}

/**
 * 将项目模板复制为事项自己的空排期节点。
 * @param template 项目内该事项类型保存的模板。
 * @returns 可独立修改的事项规划；未设置模板时使用既有的空规划。
 */
export function instantiateWorkItemTemplate(template: WorkItemTemplate | undefined): WorkItemPlan {
  return (template ?? []).map(({ id, title }) => ({ id, title, startsOn: null, endsOn: null, tasks: [] }))
}

/**
 * 校验模板节点名称、标识与默认流程节点的相对顺序。
 * @param kind 事项类型。
 * @param template 按时间线顺序排列的模板节点。
 * @returns 已规范化节点名称的模板。
 * @throws 节点无效或缺少既有状态动作所需的节点时抛出业务校验错误。
 */
export function validateWorkItemTemplate(kind: WorkItemKind, template: WorkItemTemplate): WorkItemTemplate {
  const nodes = validateWorkItemPlan(instantiateWorkItemTemplate(template))
  const stages = REQUIRED_STAGES[kind]
  const stageIds = nodes.filter(({ id }) => stages.includes(id)).map(({ id }) => id)
  if (stageIds.length !== stages.length || stages.some((id, index) => stageIds[index] !== id)) {
    throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '模板必须保留默认流程节点及其相对顺序')
  }
  return nodes.map(({ id, title }) => ({ id, title }))
}
