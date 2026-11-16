import { Type, type Static } from 'typebox'
import { ERROR_CODES } from '../../platform/http/error-codes.ts'
import { ApiError } from '../../platform/http/errors.ts'

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
  maxItems: 24,
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
