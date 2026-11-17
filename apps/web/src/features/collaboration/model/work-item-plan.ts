import type { ApiSuccessData } from '@dev-ops/api-client'

export type WorkItemPlan = NonNullable<ApiSuccessData<'/api/v1/requirements/{requirementId}', 'get'>['plan']>
export type PlanNode = WorkItemPlan[number]
export type PlanningKind = 'requirement' | 'bug'
export type NodeProgress = '已完成' | '未进入' | '待开始' | '进行中'

/** 单个事项或模板可使用的节点上限。 */
export const WORK_ITEM_NODE_LIMIT = 24

/** 流程状态对应的初始规划节点，名称由各事项独立保存。 */
const WORK_ITEM_STAGES = {
  requirement: [
    ['pending', '待处理', '待开始'],
    ['in_development', '开发', '进行中'],
    ['submitted', '待测试', '待开始'],
    ['in_testing', '测试', '进行中'],
    ['passed', '已通过', '已完成'],
  ],
  bug: [
    ['pending', '待处理', '待开始'],
    ['in_fix', '修复', '进行中'],
    ['in_regression', '回归', '待开始'],
    ['resolved', '已解决', '已完成'],
  ],
} as const

const DAY_MS = 86_400_000

/**
 * 读取一个事项的完整规划，旧事项先展示流程的初始节点。
 * @param kind 事项类型。
 * @param stored 已保存的规划，可省略尚未维护的流程节点。
 * @returns 已保存的节点顺序。旧规划缺少默认节点时补齐这些节点。
 */
export function planNodes(kind: PlanningKind, stored?: WorkItemPlan): WorkItemPlan {
  const defaults = WORK_ITEM_STAGES[kind]
  const nodeById = new Map(stored?.map((node) => [node.id, node]))
  if (stored && defaults.every(([id]) => nodeById.has(id))) return stored
  return [
    ...defaults.map(([id, title]) => nodeById.get(id) ?? { id, title, startsOn: null, endsOn: null, tasks: [] }),
    ...(stored ?? []).filter((node) => !defaults.some(([id]) => id === node.id)),
  ]
}

/**
 * 判断节点是否承载既有状态动作。
 * @param kind 事项类型。
 * @param id 流程节点标识，改名时保持原值。
 * @returns 是否为内置流程节点。
 */
export function isWorkflowStage(kind: PlanningKind, id: string): boolean {
  return WORK_ITEM_STAGES[kind].some(([stage]) => stage === id)
}

/**
 * 读取节点在当前事项中的进度。
 * @param kind 事项类型。
 * @param node 当前时间线节点。
 * @param status 事项实际状态。
 * @returns 内置节点对应的流程进度，或由自定义节点的任务计算的进度。终止后的内置节点没有进度标记。
 */
export function planNodeProgress(kind: PlanningKind, node: PlanNode, status: string): NodeProgress | null {
  const stages = WORK_ITEM_STAGES[kind]
  const stageIndex = stages.findIndex(([id]) => id === node.id)
  if (stageIndex < 0) {
    const done = node.tasks.filter((task) => task.done).length
    if (done === 0) return '待开始'
    return done === node.tasks.length ? '已完成' : '进行中'
  }
  const currentIndex = stages.findIndex(([id]) => id === status)
  if (currentIndex < 0) return null
  if (stageIndex < currentIndex) return '已完成'
  if (stageIndex > currentIndex) return '未进入'
  return stages[stageIndex]?.[2] ?? null
}

/**
 * 汇总节点与任务的完整排期，重叠日期只计算一次。
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
