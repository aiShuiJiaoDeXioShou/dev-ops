import { openAsBlob } from 'node:fs'
import { basename, extname } from 'node:path'
import type { Command } from 'commander'

import { collectValues } from '../lib/api-command.ts'
import {
  businessContext,
  collectAllPages,
  globalsOf,
  readContent,
  resolveTeamId,
  type BusinessCommandContext,
} from '../lib/command.ts'
import type { CliContext } from '../lib/context.ts'
import { CliError } from '../lib/errors.ts'
import {
  gitChangedFiles,
  gitCommitsSince,
  gitHead,
  gitRemoteUrl,
  gitUnpushedShas,
  normalizeRepositoryUrl,
} from '../lib/git.ts'
import { humanText, printSuccess } from '../lib/output.ts'
import {
  clearWorkBinding,
  formatWorkItemRef,
  readWorkBinding,
  requireTrackedBinding,
  writeWorkBinding,
  type TrackedBinding,
  type WorkItemKind,
} from '../lib/work-binding.ts'
import {
  addPlanTasks,
  changedWorkspaces,
  commentWorkItem,
  computeWorkGaps,
  fetchWorkItem,
  isCommitLinked,
  planTasks,
  setPlanTasksDone,
  updateWorkItem,
  workWriteOptions,
  type WorkCommitView,
  type WorkItemSnapshot,
} from '../lib/work-item.ts'

/** 组合命令没有单一服务端请求，JSON 信封使用固定的本地请求标识。 */
const LOCAL_REQUEST_ID = 'local'

/** 单次更新事项允许绑定的附件上限，与需求/Bug 更新契约一致。 */
const MAX_ATTACHMENTS_PER_ITEM = 10

/** 已结束的事项不能再绑定开发；需要先在平台重新打开。 */
const CLOSED_STATUSES: Record<WorkItemKind, readonly string[]> = {
  requirement: ['passed', 'cancelled'],
  bug: ['resolved', 'closed'],
}

/** 开发中的状态；交付时只有处于该状态才执行提测或提交回归。 */
const ACTIVE_STATUSES: Record<WorkItemKind, string> = { requirement: 'in_development', bug: 'in_fix' }

const SELF_TEST_RESULTS = ['passed', 'has_failures', 'not_run', 'not_applicable'] as const
type SelfTestResult = (typeof SELF_TEST_RESULTS)[number]

/** 附件用途；文件名前缀让 Web 详情页在没有分类字段前也能一眼区分。 */
const ATTACHMENT_KINDS = { design: '设计稿', screenshot: '截图', report: '测试报告', other: '' } as const
type AttachmentKind = keyof typeof ATTACHMENT_KINDS

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.htm': 'text/html',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.md': 'text/markdown',
  '.txt': 'text/plain',
  '.log': 'text/plain',
  '.json': 'application/json',
  '.csv': 'text/csv',
}

interface StartOptions {
  project?: string
  repository?: string
  bug?: boolean
  untracked?: string
}

interface StatusOptions {
  local?: boolean
}

interface AttachOptions {
  kind: string
  note?: string
}

interface LogOptions {
  contentFile?: string
}

interface LinkOptions {
  pr: string[]
}

interface DeliverOptions {
  summary?: string
  verification?: string
  selfTest?: string
  testOwner: string[]
  testEntry?: string
  verifier?: string
  pr: string[]
  transition: boolean
}

/** 事项引用：项目内编号或平台 UUID。 */
type WorkItemReference = { kind: WorkItemKind; number: number } | { kind: WorkItemKind; id: string }

/** `work status` 输出；hooks 依赖该结构，字段调整需同步 tooling/agent-hooks。 */
export interface WorkStatusView {
  binding: 'none' | 'untracked' | 'tracked'
  reason?: string
  item?: Pick<WorkItemSnapshot, 'kind' | 'id' | 'ref' | 'title' | 'status' | 'version' | 'projectId'>
  tasks?: { total: number; done: number; open: Array<{ id: string; title: string }> }
  attachmentCount?: number
  commits?: WorkCommitView[]
  workspaces?: string[]
  gaps: Array<{ code: string; blocking: boolean; message: string }>
}

function cwdOf(context: CliContext): string {
  return context.cwd ?? process.cwd()
}

function requireText(value: string | undefined, message: string): string {
  const text = value?.trim()
  if (!text) throw new CliError(message, 2, { code: 'INVALID_ARGUMENTS' })
  return text
}

function print(context: CliContext, command: Command, data: unknown, render: (data: unknown) => string = humanText) {
  printSuccess({ json: globalsOf(command).json === true, stdout: context.stdout }, data, LOCAL_REQUEST_ID, render)
}

/**
 * 解析事项引用：`REQ-12`、`BUG-3` 或 UUID。
 * @param value 命令参数。
 * @param isBug UUID 是否表示 Bug。
 * @returns 事项类型与编号或标识。
 * @throws 格式不合法时抛出退出码 2 的 CliError。
 */
export function parseWorkItemReference(value: string, isBug: boolean): WorkItemReference {
  const numbered = /^(req|bug)-?(\d+)$/i.exec(value.trim())
  if (numbered) {
    const kind: WorkItemKind = numbered[1]?.toLowerCase() === 'bug' ? 'bug' : 'requirement'
    return { kind, number: Number(numbered[2]) }
  }
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.trim())) {
    return { kind: isBug ? 'bug' : 'requirement', id: value.trim() }
  }
  throw new CliError('事项引用格式应为 REQ-<编号>、BUG-<编号> 或 UUID（Bug UUID 需加 --bug）', 2, {
    code: 'INVALID_WORK_ITEM_REF',
  })
}

/**
 * 找到关联当前 Git 远端的项目与仓库；未指定项目时遍历团队内活跃项目。
 * @returns 项目与仓库标识。
 * @throws 没有或有多个项目关联该仓库时抛出 CliError，提示用 --project / --repository 指定。
 */
async function resolveProjectRepository(
  context: CliContext,
  business: BusinessCommandContext,
  options: StartOptions,
): Promise<{ projectId: string; repositoryId: string }> {
  const remote = normalizeRepositoryUrl(await gitRemoteUrl(cwdOf(context)))
  let projectIds: string[]
  if (options.project) {
    projectIds = [options.project]
  } else {
    const teamId = await resolveTeamId(context, business)
    const projects = await collectAllPages((page) =>
      business.client.listProjects(teamId, { page, pageSize: 100, status: 'active' }),
    )
    projectIds = projects.data.items.map((project) => project.id)
  }
  const matches: Array<{ projectId: string; repositoryId: string }> = []
  for (const projectId of projectIds) {
    const { data } = await business.client.listProjectRepositories(projectId)
    for (const repository of data) {
      const isSelected = options.repository
        ? repository.id === options.repository
        : normalizeRepositoryUrl(repository.webUrl) === remote
      if (isSelected) matches.push({ projectId, repositoryId: repository.id })
    }
  }
  const [match] = matches
  if (match && matches.length === 1) return match
  if (matches.length === 0) {
    throw new CliError(`没有项目关联当前仓库 ${remote}；请用 --project 与 --repository 指定`, 1, {
      code: 'WORK_PROJECT_NOT_FOUND',
    })
  }
  throw new CliError(
    `多个项目关联当前仓库，请用 --project 指定：${matches.map((item) => item.projectId).join('、')}`,
    2,
    { code: 'WORK_PROJECT_AMBIGUOUS' },
  )
}

/**
 * 按编号或标识找到项目内的事项。
 * @throws 事项不存在或不属于该项目时抛出退出码 1 的 CliError。
 */
async function resolveWorkItem(
  business: BusinessCommandContext,
  projectId: string,
  reference: WorkItemReference,
): Promise<WorkItemSnapshot> {
  let itemId: string | undefined
  if ('id' in reference) {
    itemId = reference.id
  } else if (reference.kind === 'requirement') {
    const { data } = await business.client.listRequirements(projectId, {
      search: String(reference.number),
      page: 1,
      pageSize: 100,
    })
    itemId = data.items.find((item) => item.number === reference.number)?.id
  } else {
    const { data } = await collectAllPages((page) => business.client.listBugs(projectId, { page, pageSize: 100 }))
    itemId = data.items.find((item) => item.number === reference.number)?.id
  }
  const label = 'id' in reference ? reference.id : formatWorkItemRef(reference.kind, reference.number)
  if (itemId === undefined) {
    throw new CliError(`项目内找不到事项 ${label}`, 1, { code: 'WORK_ITEM_NOT_FOUND' })
  }
  const item = await fetchWorkItem(business, reference.kind, itemId)
  if (item.projectId !== projectId) {
    throw new CliError(`事项 ${label} 不属于当前仓库关联的项目`, 1, { code: 'WORK_ITEM_NOT_FOUND' })
  }
  return item
}

/** 读取绑定事项、本地提交及推送/关联情况。 */
async function collectWorkProgress(context: CliContext, business: BusinessCommandContext, binding: TrackedBinding) {
  const cwd = cwdOf(context)
  const item = await fetchWorkItem(business, binding.kind, binding.itemId)
  const [head, localCommits, unpushed, changedFiles] = await Promise.all([
    gitHead(cwd),
    gitCommitsSince(cwd, binding.baseSha),
    gitUnpushedShas(cwd, binding.baseSha),
    gitChangedFiles(cwd, binding.baseSha),
  ])
  const commits: WorkCommitView[] = localCommits.map((commit) => ({
    ...commit,
    isPushed: !unpushed.has(commit.sha),
    isLinked: isCommitLinked(commit.sha, item.linkedCommitShas),
  }))
  return { item, head, commits, workspaces: changedWorkspaces(changedFiles) }
}

/**
 * 关联已推送且未关联的提交，以及指定 PR。
 * @returns 新关联的对象与失败项；失败项不包含服务端原始响应。
 */
async function linkCode(
  business: BusinessCommandContext,
  binding: TrackedBinding,
  commits: WorkCommitView[],
  pullRequests: string[],
): Promise<{ linked: string[]; failed: Array<{ target: string; message: string }> }> {
  const targets = [
    ...commits
      .filter((commit) => commit.isPushed && !commit.isLinked)
      .map((commit) => ({ objectType: 'commit' as const, remoteId: commit.sha, label: commit.sha.slice(0, 7) })),
    ...pullRequests.map((number) => ({
      objectType: 'change_request' as const,
      remoteId: requireText(number, '--pr 不能为空'),
      label: `PR #${number}`,
    })),
  ]
  const linked: string[] = []
  const failed: Array<{ target: string; message: string }> = []
  for (const target of targets) {
    try {
      await business.client.createCodeReference(
        binding.projectId,
        {
          targetType: binding.kind,
          targetId: binding.itemId,
          repositoryId: binding.repositoryId,
          objectType: target.objectType,
          remoteId: target.remoteId,
        },
        workWriteOptions(business),
      )
      linked.push(target.label)
    } catch (error) {
      failed.push({ target: target.label, message: error instanceof Error ? error.message : '关联失败' })
    }
  }
  return { linked, failed }
}

function linkFailureError(failed: Array<{ target: string; message: string }>): CliError {
  const detail = failed.map((item) => `${item.target}：${item.message}`).join('；')
  return new CliError(`代码关联失败：${detail}。确认提交已推送到项目关联仓库后重试 devops work link`, 1, {
    code: 'WORK_LINK_FAILED',
  })
}

function renderStatus(data: unknown): string {
  const view = data as WorkStatusView
  if (view.binding === 'none') return '当前工作区未绑定事项。修改仓库前运行 devops work start <REQ-编号|BUG-编号>\n'
  if (view.binding === 'untracked') return `当前工作区声明无需事项：${view.reason ?? ''}\n`
  const lines: string[] = []
  if (view.item) lines.push(`${view.item.ref} ${view.item.title}（${view.item.status}）`)
  if (view.tasks) lines.push(`待办：${view.tasks.done}/${view.tasks.total} 完成`)
  if (view.commits) {
    const pushed = view.commits.filter((commit) => commit.isPushed).length
    const linked = view.commits.filter((commit) => commit.isLinked).length
    lines.push(`提交：${view.commits.length} 个，已推送 ${pushed}，已关联 ${linked}`)
  }
  for (const gap of view.gaps) lines.push(`${gap.blocking ? '待完成' : '提示'}：${gap.message}`)
  return `${lines.join('\n')}\n`
}

function registerStartCommand(work: Command, context: CliContext): void {
  work
    .command('start')
    .description('绑定当前工作区要处理的事项；待处理的需求/Bug 自动流转为开发中/修复中')
    .argument('[ref]', 'REQ-<编号>、BUG-<编号> 或事项 UUID')
    .option('--project <projectId>', '项目 ID；省略时按当前 Git 远端查找关联项目')
    .option('--repository <repositoryId>', '项目关联仓库 ID；省略时按当前 Git 远端匹配')
    .option('--bug', 'UUID 参数表示 Bug')
    .option('--untracked <reason>', '声明本次改动无需事项并说明原因，例如咨询或平台故障恢复')
    .action(async (ref: string | undefined, options: StartOptions, command: Command) => {
      const cwd = cwdOf(context)
      const startedAt = new Date().toISOString()
      if (options.untracked !== undefined) {
        if (ref !== undefined)
          throw new CliError('--untracked 不能与事项引用同时使用', 2, { code: 'INVALID_ARGUMENTS' })
        const reason = requireText(options.untracked, '--untracked 需要说明原因')
        await writeWorkBinding(cwd, { mode: 'untracked', reason, startedAt })
        print(context, command, { binding: 'untracked', reason })
        return
      }
      const reference = parseWorkItemReference(
        requireText(ref, '缺少事项引用，例如 devops work start REQ-12'),
        options.bug === true,
      )
      const business = await businessContext(command, context)
      const { projectId, repositoryId } = await resolveProjectRepository(context, business, options)
      let item = await resolveWorkItem(business, projectId, reference)
      if (CLOSED_STATUSES[item.kind].includes(item.status)) {
        throw new CliError(`${item.ref} 已是 ${item.status}，请先在平台重新打开再开发`, 1, { code: 'WORK_ITEM_CLOSED' })
      }
      const isPending = item.status === 'pending'
      if (isPending) {
        const body = { version: item.version }
        if (item.kind === 'requirement') {
          await business.client.startRequirementDevelopment(item.id, body, workWriteOptions(business))
        } else {
          await business.client.startBugFix(item.id, body, workWriteOptions(business))
        }
        item = await fetchWorkItem(business, item.kind, item.id)
      }
      const previous = await readWorkBinding(cwd)
      const isSameItem = previous?.mode === 'tracked' && previous.itemId === item.id
      const binding: TrackedBinding = isSameItem
        ? previous
        : {
            mode: 'tracked',
            projectId,
            repositoryId,
            kind: item.kind,
            itemId: item.id,
            number: item.number,
            title: item.title,
            baseSha: await gitHead(cwd),
            startedAt,
            reported: null,
            delivered: null,
          }
      await writeWorkBinding(cwd, binding)
      const hints =
        planTasks(item.plan).length === 0
          ? ['跨多个应用、含接口契约或数据库迁移、预计超过一天时，先用 devops work task add 按可独立验收的提交拆分待办']
          : []
      print(context, command, {
        ref: item.ref,
        title: item.title,
        status: item.status,
        transitioned: isPending,
        projectId,
        repositoryId,
        baseSha: binding.baseSha,
        hints,
      })
    })
}

function registerStatusCommand(work: Command, context: CliContext): void {
  work
    .command('status')
    .description('汇总绑定事项的状态、待办、提交关联与尚未完成的追踪步骤')
    .option('--local', '只读取本地绑定，不访问服务')
    .action(async (options: StatusOptions, command: Command) => {
      const binding = await readWorkBinding(cwdOf(context))
      if (binding === null) {
        print(context, command, { binding: 'none', gaps: [] } satisfies WorkStatusView, renderStatus)
        return
      }
      if (binding.mode === 'untracked') {
        const view: WorkStatusView = { binding: 'untracked', reason: binding.reason, gaps: [] }
        print(context, command, view, renderStatus)
        return
      }
      if (options.local) {
        const view: WorkStatusView = {
          binding: 'tracked',
          item: {
            kind: binding.kind,
            id: binding.itemId,
            ref: formatWorkItemRef(binding.kind, binding.number),
            title: binding.title,
            status: 'unknown',
            version: 0,
            projectId: binding.projectId,
          },
          gaps: [],
        }
        print(context, command, view, renderStatus)
        return
      }
      const business = await businessContext(command, context)
      const progress = await collectWorkProgress(context, business, binding)
      const tasks = planTasks(progress.item.plan)
      const view: WorkStatusView = {
        binding: 'tracked',
        item: {
          kind: progress.item.kind,
          id: progress.item.id,
          ref: progress.item.ref,
          title: progress.item.title,
          status: progress.item.status,
          version: progress.item.version,
          projectId: progress.item.projectId,
        },
        tasks: {
          total: tasks.length,
          done: tasks.filter((task) => task.done).length,
          open: tasks.filter((task) => !task.done).map((task) => ({ id: task.id, title: task.title })),
        },
        attachmentCount: progress.item.attachmentIds.length,
        commits: progress.commits,
        workspaces: progress.workspaces,
        gaps: computeWorkGaps({ binding, ...progress }),
      }
      print(context, command, view, renderStatus)
    })
}

function registerTaskCommands(work: Command, context: CliContext): void {
  const task = work.command('task').description('增量维护绑定事项的规划待办')
  task
    .command('list')
    .description('列出规划节点与待办')
    .action(async (_options: unknown, command: Command) => {
      const binding = await requireTrackedBinding(cwdOf(context))
      const business = await businessContext(command, context)
      const item = await fetchWorkItem(business, binding.kind, binding.itemId)
      const tasks = planTasks(item.plan)
      print(context, command, { ref: item.ref, tasks }, () =>
        tasks.length === 0
          ? `${item.ref} 还没有待办\n`
          : `${tasks.map((entry) => `[${entry.done ? 'x' : ' '}] ${entry.id} ${entry.title}（${entry.nodeTitle}）`).join('\n')}\n`,
      )
    })
  task
    .command('add')
    .description('追加待办；一个待办对应一个可独立验收的提交')
    .argument('<titles...>', '待办名称，可一次传多个')
    .option('--node <nodeId>', '目标规划节点 ID；省略时使用第一个节点，没有节点时创建“开发”节点')
    .action(async (titles: string[], options: { node?: string }, command: Command) => {
      const cleaned = titles.map((title) => requireText(title, '待办名称不能为空'))
      const binding = await requireTrackedBinding(cwdOf(context))
      const business = await businessContext(command, context)
      const item = await fetchWorkItem(business, binding.kind, binding.itemId)
      const result = addPlanTasks(item.plan, cleaned, options.node)
      await updateWorkItem(business, item, { plan: result.plan })
      print(context, command, { ref: item.ref, added: result.taskIds })
    })
  for (const [name, isDone, description] of [
    ['done', true, '标记待办已完成'],
    ['undo', false, '把待办改回未完成'],
  ] as const) {
    task
      .command(name)
      .description(description)
      .argument('<taskIds...>', '待办 ID，例如 t1')
      .action(async (taskIds: string[], _options: unknown, command: Command) => {
        const binding = await requireTrackedBinding(cwdOf(context))
        const business = await businessContext(command, context)
        const item = await fetchWorkItem(business, binding.kind, binding.itemId)
        await updateWorkItem(business, item, { plan: setPlanTasksDone(item.plan, taskIds, isDone) })
        print(context, command, { ref: item.ref, [isDone ? 'done' : 'undone']: taskIds })
      })
  }
}

function registerAttachCommand(work: Command, context: CliContext): void {
  work
    .command('attach')
    .description('上传设计稿、截图、测试报告等文件并追加到绑定事项，保留已有附件')
    .argument('<files...>', '本地文件路径')
    .option('--kind <kind>', `文件用途：${Object.keys(ATTACHMENT_KINDS).join('、')}`, 'other')
    .option('--note <text>', '同时追加一条评论说明这些文件')
    .action(async (files: string[], options: AttachOptions, command: Command) => {
      const kind = Object.keys(ATTACHMENT_KINDS).find(
        (candidate): candidate is AttachmentKind => candidate === options.kind,
      )
      if (kind === undefined) {
        throw new CliError(`--kind 可选值：${Object.keys(ATTACHMENT_KINDS).join('、')}`, 2, {
          code: 'INVALID_ARGUMENTS',
        })
      }
      const blobs = await Promise.all(
        files.map(async (file) => {
          const blob = await openAsBlob(file).catch(() => {
            throw new CliError(`无法读取文件：${file}`, 2, { code: 'CONTENT_READ_FAILED' })
          })
          return { file, blob }
        }),
      )
      const binding = await requireTrackedBinding(cwdOf(context))
      const business = await businessContext(command, context)
      const item = await fetchWorkItem(business, binding.kind, binding.itemId)
      const policy = (await business.client.getAttachmentPolicy()).data
      const limit = Math.min(MAX_ATTACHMENTS_PER_ITEM, policy.maxFilesPerRecord)
      if (item.attachmentIds.length + files.length > limit) {
        throw new CliError(`${item.ref} 最多绑定 ${limit} 个附件，当前已有 ${item.attachmentIds.length} 个`, 2, {
          code: 'ATTACHMENT_LIMIT_EXCEEDED',
        })
      }
      const oversized = blobs.find(({ blob }) => blob.size < 1 || blob.size > policy.maxFileBytes)
      if (oversized) {
        throw new CliError(`附件为空或超过服务端大小限制：${oversized.file}`, 2, { code: 'ATTACHMENT_INVALID' })
      }
      const prefix = ATTACHMENT_KINDS[kind]
      const uploaded: Array<{ id: string; name: string }> = []
      for (const { file, blob } of blobs) {
        const name = prefix ? `${prefix}-${basename(file)}` : basename(file)
        const contentType = CONTENT_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream'
        const { data } = await business.client.uploadAttachment(binding.projectId, blob, { name, contentType })
        uploaded.push({ id: data.attachment.id, name })
      }
      await updateWorkItem(business, item, {
        attachmentIds: [...item.attachmentIds, ...uploaded.map((attachment) => attachment.id)],
      })
      if (options.note?.trim()) {
        const list = uploaded.map((attachment) => `- ${attachment.name}`).join('\n')
        await commentWorkItem(business, item, `${options.note.trim()}\n\n${list}`)
      }
      print(context, command, { ref: item.ref, attachments: uploaded })
    })
}

function registerLogCommand(work: Command, context: CliContext): void {
  work
    .command('log')
    .description('在绑定事项追加方案、决策或进展评论，并记录当前 HEAD 已回写')
    .argument('[text...]', '评论正文；较长内容使用 --content-file')
    .option('--content-file <path>', 'Markdown 文件；- 表示标准输入')
    .action(async (words: string[], options: LogOptions, command: Command) => {
      const text = options.contentFile ? await readContent(options.contentFile, context) : words.join(' ')
      const body = requireText(text, '评论内容不能为空')
      const cwd = cwdOf(context)
      const binding = await requireTrackedBinding(cwd)
      const business = await businessContext(command, context)
      await commentWorkItem(business, { kind: binding.kind, id: binding.itemId }, body)
      const head = await gitHead(cwd)
      await writeWorkBinding(cwd, { ...binding, reported: { head, at: new Date().toISOString() } })
      print(context, command, { ref: formatWorkItemRef(binding.kind, binding.number), commented: true })
    })
}

function registerLinkCommand(work: Command, context: CliContext): void {
  work
    .command('link')
    .description('把已推送且未关联的提交及指定 PR 关联到绑定事项')
    .option('--pr <number>', 'PR 编号，可重复', collectValues, [])
    .action(async (options: LinkOptions, command: Command) => {
      const binding = await requireTrackedBinding(cwdOf(context))
      const business = await businessContext(command, context)
      const progress = await collectWorkProgress(context, business, binding)
      const result = await linkCode(business, binding, progress.commits, options.pr)
      if (result.failed.length > 0) throw linkFailureError(result.failed)
      const localOnly = progress.commits.filter((commit) => !commit.isPushed).map((commit) => commit.sha.slice(0, 7))
      print(context, command, { ref: progress.item.ref, linked: result.linked, localOnly })
    })
}

function deliveryComment(options: {
  summary: string
  verification: string
  selfTest: SelfTestResult | undefined
  commits: WorkCommitView[]
  linked: string[]
  item: WorkItemSnapshot
}): string {
  const linked = new Set(options.linked)
  const commitLines = options.commits.map((commit) => {
    const short = commit.sha.slice(0, 7)
    const state = commit.isLinked || linked.has(short) ? '已关联' : commit.isPushed ? '已推送' : '仅本地，推送后关联'
    return `- \`${short}\` ${commit.subject}（${state}）`
  })
  const tasks = planTasks(options.item.plan)
  return [
    '## 交付记录',
    '',
    `**说明**：${options.summary}`,
    '',
    `**验证**：${options.verification}`,
    ...(options.selfTest ? ['', `**自测结论**：${options.selfTest}`] : []),
    ...(tasks.length > 0 ? ['', `**待办**：${tasks.filter((task) => task.done).length}/${tasks.length} 完成`] : []),
    '',
    '**提交**：',
    ...(commitLines.length > 0 ? commitLines : ['- 无新提交']),
  ].join('\n')
}

function registerDeliverCommand(work: Command, context: CliContext): void {
  work
    .command('deliver')
    .description('关联代码、写回验证结果，并让需求提测或 Bug 提交回归')
    .option('--summary <text>', '交付说明：需求为测试范围，Bug 为修复说明（必填）')
    .option('--verification <text>', '实际执行的检查与结果，未运行的检查要写明（必填）')
    .option('--self-test <result>', `需求自测结论：${SELF_TEST_RESULTS.join('、')}（需求必填）`)
    .option('--test-owner <userId>', '测试负责人，可重复；省略时使用需求上的测试负责人', collectValues, [])
    .option('--test-entry <text>', '需求测试入口说明')
    .option('--verifier <userId>', 'Bug 回归负责人；省略时由平台选择')
    .option('--pr <number>', '同时关联的 PR 编号，可重复', collectValues, [])
    .option('--no-transition', '只回写记录，不提测或提交回归，例如阶段性交付')
    .action(async (options: DeliverOptions, command: Command) => {
      const summary = requireText(options.summary, '缺少 --summary 交付说明')
      const verification = requireText(options.verification, '缺少 --verification 验证结果')
      const cwd = cwdOf(context)
      const binding = await requireTrackedBinding(cwd)
      let selfTest: SelfTestResult | undefined
      if (binding.kind === 'requirement') {
        selfTest = SELF_TEST_RESULTS.find((candidate) => candidate === options.selfTest)
        if (selfTest === undefined) {
          throw new CliError(`需求交付需要 --self-test：${SELF_TEST_RESULTS.join('、')}`, 2, {
            code: 'INVALID_ARGUMENTS',
          })
        }
      }
      const business = await businessContext(command, context)
      const progress = await collectWorkProgress(context, business, binding)
      const link = await linkCode(business, binding, progress.commits, options.pr)
      if (link.failed.length > 0) throw linkFailureError(link.failed)
      await commentWorkItem(
        business,
        progress.item,
        deliveryComment({
          summary,
          verification,
          selfTest,
          commits: progress.commits,
          linked: link.linked,
          item: progress.item,
        }),
      )
      const transition = await transitionAfterDelivery(business, binding, {
        ...options,
        summary,
        verification,
        selfTest,
      })
      const checkpoint = { head: progress.head, at: new Date().toISOString() }
      await writeWorkBinding(cwd, { ...binding, reported: checkpoint, delivered: checkpoint })
      print(context, command, {
        ref: progress.item.ref,
        linked: link.linked,
        localOnly: progress.commits.filter((commit) => !commit.isPushed).map((commit) => commit.sha.slice(0, 7)),
        transition,
      })
    })
}

/**
 * 交付记录写入后执行提测或提交回归。
 * @returns 流转结果；无法流转时返回原因，由编码助手转告用户，不视为命令失败。
 */
async function transitionAfterDelivery(
  business: BusinessCommandContext,
  binding: TrackedBinding,
  options: DeliverOptions & { summary: string; verification: string; selfTest: SelfTestResult | undefined },
): Promise<{ status: string; skipped?: string }> {
  const item = await fetchWorkItem(business, binding.kind, binding.itemId)
  if (!options.transition) return { status: item.status, skipped: '已指定 --no-transition' }
  if (item.status !== ACTIVE_STATUSES[item.kind]) {
    return { status: item.status, skipped: `当前状态 ${item.status} 不需要流转` }
  }
  if (item.kind === 'bug') {
    const result = await business.client.submitBugRegression(
      item.id,
      {
        version: item.version,
        fixSummary: options.summary,
        ...(options.verifier ? { verifierUserId: options.verifier } : {}),
      },
      workWriteOptions(business),
    )
    return { status: result.data.bug.status }
  }
  const testOwners = options.testOwner.length > 0 ? options.testOwner : item.testOwnerUserIds
  const [testOwnerUserId] = testOwners
  if (testOwnerUserId === undefined) {
    return { status: item.status, skipped: '需求没有测试负责人，向用户确认后用 --test-owner 重新交付' }
  }
  const result = await business.client.submitRequirementTest(
    item.id,
    {
      version: item.version,
      testOwnerUserId,
      ...(testOwners.length > 1 ? { testOwnerUserIds: testOwners } : {}),
      scopeNote: options.summary,
      selfTestResult: options.selfTest ?? 'not_run',
      ...(options.selfTest === 'passed' ? {} : { selfTestNote: options.verification }),
      ...(options.testEntry ? { testEntry: options.testEntry } : {}),
    },
    workWriteOptions(business),
  )
  return { status: result.data.requirement.status }
}

/**
 * 注册 `devops work`：把当前 Git 工作区绑定到一个需求或 Bug，并把规划、附件、代码关联与交付流转
 * 封装为编码助手可直接调用的组合命令。绑定保存在当前 worktree 的私有 git 目录。
 * @param program 根命令。
 * @param context CLI 输入输出上下文；`cwd` 指定本地仓库目录。
 */
export function registerWorkCommands(program: Command, context: CliContext): void {
  const work = program.command('work').description('绑定当前工作区的事项，维护待办、附件、代码关联与交付流转')
  registerStartCommand(work, context)
  registerStatusCommand(work, context)
  registerTaskCommands(work, context)
  registerAttachCommand(work, context)
  registerLogCommand(work, context)
  registerLinkCommand(work, context)
  registerDeliverCommand(work, context)
  work
    .command('stop')
    .description('解除当前工作区的事项绑定')
    .action(async (_options: unknown, command: Command) => {
      const cwd = cwdOf(context)
      const previous = await readWorkBinding(cwd).catch(() => null)
      await clearWorkBinding(cwd)
      const ref = previous?.mode === 'tracked' ? formatWorkItemRef(previous.kind, previous.number) : null
      print(context, command, { cleared: true, ref })
    })
}
