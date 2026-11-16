import type { ApiSuccessData } from '@dev-ops/api-client'

export type WorkItemPlan = NonNullable<ApiSuccessData<'/api/v1/requirements/{requirementId}', 'get'>['plan']>
export type PlanNode = WorkItemPlan[number]
export type PlanTask = PlanNode['tasks'][number]
export type PlanningKind = 'requirement' | 'bug'

/** 流程状态对应的初始规划节点，名称由各事项独立保存。 */
export const WORK_ITEM_STAGES = {
  requirement: [
    ['pending', '待处理'],
    ['in_development', '开发'],
    ['submitted', '待测试'],
    ['in_testing', '测试'],
    ['passed', '已通过'],
  ],
  bug: [
    ['pending', '待处理'],
    ['in_fix', '修复'],
    ['in_regression', '回归'],
    ['resolved', '已解决'],
  ],
} as const

const DAY_MS = 86_400_000

/**
 * 读取一个事项的完整规划，旧事项先展示流程的初始节点。
 * @param kind 事项类型。
 * @param stored 已保存的规划，可省略尚未维护的流程节点。
 * @returns 按流程排列的节点和后追加的自定义节点。
 */
export function planNodes(kind: PlanningKind, stored?: WorkItemPlan): WorkItemPlan {
  const defaults: readonly (readonly [string, string])[] = WORK_ITEM_STAGES[kind]
  const nodeById = new Map(stored?.map((node) => [node.id, node]))
  return [
    ...defaults.map(([id, title]) => nodeById.get(id) ?? { id, title, startsOn: null, endsOn: null, tasks: [] }),
    ...(stored ?? []).filter((node) => !defaults.some(([id]) => id === node.id)),
  ]
}

/**
 * 汇总节点与待办的完整排期，重叠日期只计算一次。
 * @param nodes 事项的规划节点。
 * @returns 最早开始、最晚结束和首尾均计入的自然日数。没有完整区间时返回 null。
 */
export function workPlanRange(nodes: WorkItemPlan) {
  let startsOn: string | null = null
  let endsOn: string | null = null
  for (const entry of nodes.flatMap((node) => [node, ...node.tasks])) {
    if (!entry.startsOn || !entry.endsOn) continue
    if (startsOn === null || entry.startsOn < startsOn) startsOn = entry.startsOn
    if (endsOn === null || entry.endsOn > endsOn) endsOn = entry.endsOn
  }
  if (!startsOn || !endsOn) return null
  const days = (Date.parse(endsOn) - Date.parse(startsOn)) / DAY_MS + 1
  return { startsOn, endsOn, days }
}
