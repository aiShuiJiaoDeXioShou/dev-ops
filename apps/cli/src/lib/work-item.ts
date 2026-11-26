import { createIdempotencyKey, type ApiBody } from '@dev-ops/api-client'

import type { BusinessCommandContext } from './command.ts'
import { CliError } from './errors.ts'
import type { LocalCommit } from './git.ts'
import { formatWorkItemRef, type TrackedBinding, type WorkItemKind } from './work-binding.ts'

/** 事项规划，需求与 Bug 共用同一契约。 */
export type WorkItemPlan = NonNullable<ApiBody<'/api/v1/requirements/{requirementId}/update', 'post'>['plan']>
type PlanTask = WorkItemPlan[number]['tasks'][number]

/** `devops work` 关心的事项字段；需求与 Bug 归一化后共用。 */
export interface WorkItemSnapshot {
  kind: WorkItemKind
  id: string
  ref: string
  number: number
  title: string
  status: string
  version: number
  projectId: string
  plan: WorkItemPlan
  attachmentIds: string[]
  linkedCommitShas: string[]
  testOwnerUserIds: string[]
}

/** 当前绑定下尚未完成的交付步骤；hooks 用 `blocking` 决定是否阻止编码助手结束。 */
export interface WorkGap {
  code: string
  blocking: boolean
  message: string
}

/** 本地提交及其推送、关联情况。 */
export interface WorkCommitView extends LocalCommit {
  isPushed: boolean
  isLinked: boolean
}

/** 规划节点在事项没有任何节点时的默认值。 */
const DEFAULT_PLAN_NODE = { id: 'develop', title: '开发' } as const

/** 写请求统一生成幂等键，允许 `--idempotency-key` 覆盖。 */
export function workWriteOptions(business: BusinessCommandContext): { idempotencyKey: string } {
  return { idempotencyKey: business.globals.idempotencyKey ?? createIdempotencyKey() }
}

/**
 * 读取需求或 Bug 并归一化为 `devops work` 使用的快照。
 * @param business 已认证的客户端上下文。
 * @param kind 事项类型。
 * @param itemId 事项标识。
 * @returns 事项快照。
 */
export async function fetchWorkItem(
  business: BusinessCommandContext,
  kind: WorkItemKind,
  itemId: string,
): Promise<WorkItemSnapshot> {
  if (kind === 'requirement') {
    const { data } = await business.client.getRequirement(itemId)
    return {
      kind,
      id: data.id,
      ref: formatWorkItemRef(kind, data.number),
      number: data.number,
      title: data.title,
      status: data.status,
      version: data.version,
      projectId: data.projectId,
      plan: data.plan ?? [],
      attachmentIds: data.attachments.map((attachment) => attachment.id),
      linkedCommitShas: commitShasOf(data.linkedCodeReferences),
      testOwnerUserIds: (data.testOwners ?? []).map((owner) => owner.userId),
    }
  }
  const { data } = await business.client.getBug(itemId)
  return {
    kind,
    id: data.id,
    ref: formatWorkItemRef(kind, data.number),
    number: data.number,
    title: data.title,
    status: data.status,
    version: data.version,
    projectId: data.projectId,
    plan: data.plan ?? [],
    attachmentIds: data.attachments.map((attachment) => attachment.id),
    linkedCommitShas: commitShasOf(data.linkedCodeReferences),
    testOwnerUserIds: [],
  }
}

function commitShasOf(references: ReadonlyArray<{ objectType: string; remoteId: string }>): string[] {
  return references.filter((reference) => reference.objectType === 'commit').map((reference) => reference.remoteId)
}

/**
 * 以当前版本写入事项规划或附件列表；版本冲突由服务端返回 VERSION_CONFLICT。
 * @param business 已认证的客户端上下文。
 * @param item 刚读取的事项快照，提供版本号。
 * @param change 要写入的规划或完整附件 ID 列表。
 */
export async function updateWorkItem(
  business: BusinessCommandContext,
  item: WorkItemSnapshot,
  change: { plan?: WorkItemPlan; attachmentIds?: string[] },
): Promise<void> {
  const body = { version: item.version, ...change }
  if (item.kind === 'requirement') {
    await business.client.updateRequirement(item.id, body, workWriteOptions(business))
    return
  }
  await business.client.updateBug(item.id, body, workWriteOptions(business))
}

/**
 * 给事项追加 Markdown 评论。
 * @param business 已认证的客户端上下文。
 * @param item 事项快照。
 * @param bodyMarkdown 评论正文。
 */
export async function commentWorkItem(
  business: BusinessCommandContext,
  item: Pick<WorkItemSnapshot, 'kind' | 'id'>,
  bodyMarkdown: string,
): Promise<void> {
  if (item.kind === 'requirement') {
    await business.client.addRequirementComment(item.id, { bodyMarkdown }, workWriteOptions(business))
    return
  }
  await business.client.addBugComment(item.id, { bodyMarkdown }, workWriteOptions(business))
}

/** 列出规划中的全部待办及所属节点。 */
export function planTasks(plan: WorkItemPlan): Array<PlanTask & { nodeId: string; nodeTitle: string }> {
  return plan.flatMap((node) => node.tasks.map((task) => ({ ...task, nodeId: node.id, nodeTitle: node.title })))
}

/**
 * 在规划中追加待办；事项没有节点时创建默认“开发”节点。
 * @param plan 当前规划。
 * @param titles 待办名称，按顺序追加。
 * @param nodeId 目标节点；省略时使用第一个节点。
 * @returns 新规划与新增待办的标识。
 * @throws 指定节点不存在时抛出退出码 2 的 CliError。
 */
export function addPlanTasks(
  plan: WorkItemPlan,
  titles: string[],
  nodeId: string | undefined,
): { plan: WorkItemPlan; taskIds: string[] } {
  const nodes: WorkItemPlan =
    plan.length > 0 ? structuredClone(plan) : [{ ...DEFAULT_PLAN_NODE, startsOn: null, endsOn: null, tasks: [] }]
  const target = nodeId === undefined ? nodes[0] : nodes.find((node) => node.id === nodeId)
  if (target === undefined) {
    const available = nodes.map((node) => `${node.id}（${node.title}）`).join('、')
    throw new CliError(`规划节点不存在，可选节点：${available}`, 2, { code: 'PLAN_NODE_NOT_FOUND' })
  }
  const usedIds = new Set(planTasks(nodes).map((task) => task.id))
  let sequence = 1
  const taskIds = titles.map((title) => {
    while (usedIds.has(`t${sequence}`)) sequence += 1
    const id = `t${sequence}`
    usedIds.add(id)
    target.tasks.push({ id, title: title.trim(), startsOn: null, endsOn: null, done: false })
    return id
  })
  return { plan: nodes, taskIds }
}

/**
 * 设置待办完成状态。
 * @param plan 当前规划。
 * @param taskIds 待办标识。
 * @param isDone 目标完成状态。
 * @returns 新规划。
 * @throws 任一标识不存在时抛出退出码 2 的 CliError，避免静默忽略写错的编号。
 */
export function setPlanTasksDone(plan: WorkItemPlan, taskIds: string[], isDone: boolean): WorkItemPlan {
  const known = new Set(planTasks(plan).map((task) => task.id))
  const unknown = taskIds.filter((id) => !known.has(id))
  if (unknown.length > 0) {
    throw new CliError(`待办不存在：${unknown.join('、')}；运行 devops work task list 查看编号`, 2, {
      code: 'PLAN_TASK_NOT_FOUND',
    })
  }
  const targets = new Set(taskIds)
  return plan.map((node) => ({
    ...node,
    tasks: node.tasks.map((task) => (targets.has(task.id) ? { ...task, done: isDone } : task)),
  }))
}

/**
 * 判断本地提交是否已关联到事项；平台保存的可能是完整或缩写 SHA。
 * @param sha 本地完整 SHA。
 * @param linkedShas 事项已关联的提交标识。
 */
export function isCommitLinked(sha: string, linkedShas: readonly string[]): boolean {
  return linkedShas.some((linked) => linked.length >= 7 && sha.startsWith(linked.toLowerCase()))
}

/**
 * 统计改动涉及的工作区；跨越多个应用或共享包说明需求较大，应拆分待办。
 * @param files 仓库相对路径。
 * @returns 去重后的 `apps/<名称>`、`packages/<名称>` 列表。
 */
export function changedWorkspaces(files: readonly string[]): string[] {
  const workspaces = new Set<string>()
  for (const file of files) {
    const [root, name] = file.split('/')
    if ((root === 'apps' || root === 'packages') && name) workspaces.add(`${root}/${name}`)
  }
  return [...workspaces].sort()
}

/** 计算交付缺项所需的输入。 */
export interface WorkGapInput {
  binding: TrackedBinding
  item: WorkItemSnapshot
  commits: WorkCommitView[]
  head: string
  workspaces: string[]
}

/**
 * 根据事项与本地提交计算尚未完成的追踪步骤。
 * @param input 绑定、事项快照、提交与改动范围。
 * @returns 缺项列表；`blocking` 为 true 的缺项会让 Stop hook 要求编码助手补完。
 * @remarks 只在出现新提交后才要求回写，避免助手每次中途向用户提问都被拦下。
 */
export function computeWorkGaps(input: WorkGapInput): WorkGap[] {
  const { binding, item, commits, head, workspaces } = input
  const gaps: WorkGap[] = []
  const startStatus = item.kind === 'requirement' ? 'in_development' : 'in_fix'
  if (item.status === 'pending') {
    gaps.push({
      code: 'NOT_STARTED',
      blocking: true,
      message: `${item.ref} 仍是待处理，运行 devops work start ${item.ref} 流转为${item.kind === 'requirement' ? '开发中' : '修复中'}`,
    })
  }
  const unlinked = commits.filter((commit) => commit.isPushed && !commit.isLinked)
  if (unlinked.length > 0) {
    gaps.push({
      code: 'UNLINKED_COMMITS',
      blocking: true,
      message: `${unlinked.length} 个已推送提交未关联到 ${item.ref}，运行 devops work link`,
    })
  }
  const hasUnreportedCommits = commits.length > 0 && binding.reported?.head !== head
  if (hasUnreportedCommits) {
    const deliverHint =
      item.status === startStatus
        ? '工作已完成时运行 devops work deliver 回写验证结果并流转'
        : '运行 devops work deliver --no-transition 回写本次修改与验证结果'
    gaps.push({
      code: 'UNREPORTED_COMMITS',
      blocking: true,
      message: `有新提交尚未回写到 ${item.ref}：先用 devops work task done 勾选已完成的待办；${deliverHint}；仍有后续工作时运行 devops work log 记录进展`,
    })
  }
  const tasks = planTasks(item.plan)
  if (tasks.length === 0 && workspaces.length >= 2) {
    gaps.push({
      code: 'PLAN_EMPTY',
      blocking: false,
      message: `改动涉及 ${workspaces.join('、')}，建议用 devops work task add 按可独立验收的提交拆分待办`,
    })
  }
  const openTasks = tasks.filter((task) => !task.done)
  if (openTasks.length > 0) {
    gaps.push({
      code: 'OPEN_TASKS',
      blocking: false,
      message: `未完成待办：${openTasks.map((task) => `${task.id} ${task.title}`).join('；')}`,
    })
  }
  if (item.kind === 'requirement' && item.testOwnerUserIds.length === 0) {
    gaps.push({
      code: 'NO_TEST_OWNER',
      blocking: false,
      message: '需求没有测试负责人，提测前向用户确认并用 devops work deliver --test-owner <用户ID> 指定',
    })
  }
  return gaps
}
