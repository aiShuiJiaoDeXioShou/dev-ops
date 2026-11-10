import { createHash, randomUUID } from 'node:crypto'
import type { PipelineInputValue } from '@dev-ops/pipeline-protocol'
import type { Database } from '../../platform/database/client.ts'
import { ERROR_CODES } from '../../platform/http/error-codes.ts'
import { ApiError } from '../../platform/http/errors.ts'
import { validatePage } from '../../platform/http/pagination.ts'
import { loadUserRefs, userNameOf } from '../identity/identity.display.ts'
import { requireTeamMember, type SessionUser } from '../identity/identity.session.ts'
import { getProjectContext } from '../projects/projects.access.ts'
import { appendPipelineActivity } from './pipeline.activity.ts'
import type { PipelineCredentialProvider } from './pipeline.credentials.ts'
import { maskErrorMessage, maskInputValue, maskSensitiveText } from './pipeline.mask.ts'
import { findActivePipelineLeaseByRun, findPipelineNodeSummariesByIds } from './pipeline.nodes.repository.ts'
import { generateRunPlan, PipelinePlanError, type RunPlanTemplate } from './pipeline.planner.ts'
import {
  aggregatePipelineRunLogs,
  findPipelineRunWithPlan,
  findLatestRunsByWorkflowPaths,
  findPipelineArtifactById,
  findPipelineArtifacts,
  findPipelineRunById,
  findPipelineRunByIdempotency,
  findPipelineRunInputs,
  findPipelineRunLogs,
  findPipelineRuns,
  findPipelineRunStep,
  findPipelineRunSteps,
  insertPipelineRun,
  insertPipelineRunSteps,
  isUniqueViolation,
  skipPendingPipelineRunSteps,
  updatePipelineRunStatus,
  type PipelineRunListFilters,
} from './pipeline.repository.ts'
import { isPipelineRunStatus, isTerminalRunStatus, parseRunPlanTemplate } from './pipeline.state.ts'
import type { PipelineStorage } from './pipeline.storage.ts'
import {
  pipelinePageView,
  toPipelineArtifactView,
  toPipelineRunLogStatView,
  toPipelineRunStepView,
  toPipelineRunView,
  type PipelineWorkflowInputView,
  type PipelineArtifactView,
  type PipelineLogReadView,
  type PipelinePageView,
  type PipelineRunDetailView,
  type PipelineRunView,
  type PipelineWorkflowDetailView,
  type PipelineWorkflowItemView,
  type PipelineWorkflowListView,
  type PipelineWorkflowParseErrorView,
  type PipelineWorkflowPlanSummaryView,
} from './pipeline.view.ts'
import {
  isPipelineWorkflowPath,
  parseWorkflowFile,
  type ParsedWorkflow,
  type WorkflowIssue,
} from './pipeline.workflow.ts'

/** 平台流水线服务配置；由 bootstrap 从集中配置注入，避免业务代码读取环境变量。 */
export interface PipelineServiceConfig {
  runTimeoutSeconds: number
  workflowMaxBytes: number
}

/** code 模块公开用例的最小端口；使用结构类型避免 pipeline 依赖 HTTP 层。 */
export interface PipelineCodePort {
  listProjectRepositories(
    actor: SessionUser,
    projectId: string,
  ): Promise<
    Array<{
      id: string
      connectionId: string
      namespace: string
      name: string
      webUrl: string
      defaultBranch: string | null
      status: string
    }>
  >
  listRepositoryTree(
    actor: SessionUser,
    projectId: string,
    repositoryId: string,
    branch?: string,
  ): Promise<{ branch: string; entries: Array<{ path: string; type: 'file' | 'directory'; size: number | null }> }>
  getRepositoryFileAtRef(
    actor: SessionUser,
    projectId: string,
    repositoryId: string,
    ref: string,
    path: string,
  ): Promise<{ branch: string; path: string; content: string; truncated: boolean }>
  listRepositoryCommits(
    actor: SessionUser,
    projectId: string,
    repositoryId: string,
    input: { ref?: string; page?: number; pageSize?: number },
  ): Promise<{ items: Array<{ sha: string }> }>
}

/** 平台服务依赖。 */
export interface PipelineServiceDeps {
  db: Database
  code: PipelineCodePort
  storage: PipelineStorage
  config: PipelineServiceConfig
  credentials: PipelineCredentialProvider
}

/** 触发运行输入；仓库由服务端根据工作流路径解析。 */
export interface TriggerPipelineRunInput {
  workflowPath: string
  ref: string
  inputs: Record<string, PipelineInputValue>
  idempotencyKey: string
  initiatorChannel: 'web' | 'api'
}

/**
 * 解析日志读取游标默认值。
 * @param afterSeq 请求传入的“不含”游标；未提供时返回 -1。
 * @returns 能读取 seq=0 首片的起始游标；日志序号从 0 开始，默认 0 会漏掉首片。
 */
export function resolveLogAfterSeq(afterSeq: number | undefined): number {
  return afterSeq ?? -1
}

/** 日志读取输入。 */
export interface ReadPipelineLogsInput {
  stepIndex?: number
  afterSeq: number
  limit: number
}

/** 产物下载信息；路由据此返回二进制响应。 */
export interface PipelineArtifactDownload {
  artifact: PipelineArtifactView
  stream: NodeJS.ReadableStream
  sizeBytes: number
}

/** 工作流文件读取结果；保留仓库标识与固定提交，供触发时复用。 */
interface WorkflowSource {
  repositoryId: string
  repositoryFullName: string
  ref: string
  commitSha: string
  path: string
  content: string
  truncated: boolean
}

function mapWorkflowIssueCode(code: WorkflowIssue['code'] | PipelinePlanError['code']) {
  switch (code) {
    case 'WORKFLOW_PARSE_ERROR':
      return ERROR_CODES.PIPELINE_WORKFLOW_PARSE_ERROR
    case 'WORKFLOW_UNSUPPORTED':
      return ERROR_CODES.PIPELINE_WORKFLOW_UNSUPPORTED
    case 'WORKFLOW_SECRET_IN_UNSAFE_POSITION':
      return ERROR_CODES.PIPELINE_WORKFLOW_SECRET_UNSAFE
    default:
      return ERROR_CODES.PIPELINE_WORKFLOW_SCHEMA_ERROR
  }
}

function toParseErrorView(issue: WorkflowIssue): PipelineWorkflowParseErrorView {
  return {
    code: issue.code,
    message: issue.message,
    ...(issue.path ? { fieldPath: issue.path } : {}),
    ...(issue.line ? { line: issue.line } : {}),
    ...(issue.column ? { column: issue.column } : {}),
  }
}

/** 计算工作流内容哈希，与服务端持久化的 workflow_hash 一致。 */
function hashWorkflowContent(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

/** 判断文本是否包含空白或控制字符；用于拒绝会把任意字符串拼进远端请求的 ref。 */
function hasUnsafeRefCharacter(value: string): boolean {
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0
    if (code <= 0x1f || code === 0x7f) return true
    if (/\s/.test(char)) return true
  }
  return false
}

/** 校验 ref 只包含 git 允许的分支/标签/提交字符，避免把任意字符串拼进远端请求。 */
function validateGitRef(value: string): string {
  const ref = value.trim()
  if (ref.length === 0 || ref.length > 300 || hasUnsafeRefCharacter(ref)) {
    throw new ApiError(ERROR_CODES.VALIDATION_ERROR, 'ref 不合法')
  }
  return ref
}

/** 将解析后的输入声明映射为详情视图；只返回声明，不返回运行时取值。 */
function toWorkflowInputViews(workflow: ParsedWorkflow): PipelineWorkflowInputView[] {
  return Object.entries(workflow.inputs).map(([name, definition]) => ({
    name,
    type: definition.type,
    required: definition.required,
    ...(definition.defaultValue === undefined ? {} : { defaultValue: definition.defaultValue }),
    ...(definition.options ? { options: definition.options } : {}),
    ...(definition.description ? { description: definition.description } : {}),
  }))
}

/** 根据解析结果构造计划摘要；不返回镜像、环境变量与密钥引用。 */
function summarizeWorkflowPlan(workflow: ParsedWorkflow): PipelineWorkflowPlanSummaryView {
  let stepIndex = 0
  return {
    jobs: workflow.jobs.map((job) => ({
      id: job.id,
      name: job.name,
      steps: job.steps.map((step) => {
        const item = { index: stepIndex, name: step.name, kind: step.kind }
        stepIndex += 1
        return item
      }),
    })),
  }
}

/**
 * 创建平台流水线控制面服务。
 * @param deps 数据库、code 读取端口、本地存储与配置。
 * @returns 工作流发现/详情、触发、运行列表/详情、取消、日志读取与产物列表/下载用例。
 * @remarks 所有用例先校验团队成员、项目归属与角色；服务端不执行用户代码，也不返回凭据明文。
 */
export function createPipelineService(deps: PipelineServiceDeps) {
  const { db, code, storage, config, credentials } = deps
  // 日志读取兜底脱敏所需的运行时密钥短时缓存；明文只在内存，不返回视图。
  const logSecretCache = new Map<string, { values: Record<string, string>; expiresAt: number }>()

  /** 读取运行引用密钥值用于日志兜底脱敏；解析失败时退化为通用模式脱敏。 */
  async function loadLogSecrets(runId: string): Promise<string[]> {
    const cached = logSecretCache.get(runId)
    if (cached && cached.expiresAt > Date.now()) return Object.values(cached.values)
    const full = await findPipelineRunWithPlan(db, runId)
    if (!full) return []
    let secretNames: string[] = []
    try {
      secretNames = parseRunPlanTemplate(full.run_plan).secretNames
    } catch {
      secretNames = []
    }
    if (secretNames.length === 0) return []
    try {
      const values = await credentials.resolveSecrets({
        teamId: full.team_id,
        projectId: full.project_id,
        names: secretNames,
      })
      logSecretCache.set(runId, { values, expiresAt: Date.now() + 60_000 })
      return Object.values(values)
    } catch {
      return []
    }
  }

  async function requireProject(actor: SessionUser, projectId: string, write: boolean) {
    const context = await getProjectContext(db, projectId)
    if (!context) throw new ApiError(ERROR_CODES.NOT_FOUND, '项目不存在')
    await requireTeamMember(db, actor.id, context.teamId, write ? ['admin', 'developer'] : undefined)
    return context
  }

  /** 把 code 模块的 Git 读取失败映射为流水线业务错误码，保留可读原因。 */
  function repositoryReadFailed(error: unknown, notFound: 'workflow' | 'commit'): never {
    if (error instanceof ApiError) {
      if (error.code === ERROR_CODES.NOT_FOUND) {
        throw new ApiError(
          notFound === 'workflow' ? ERROR_CODES.PIPELINE_WORKFLOW_NOT_FOUND : ERROR_CODES.PIPELINE_COMMIT_NOT_FOUND,
          notFound === 'workflow' ? '指定工作流文件不存在' : '指定提交或 ref 不可达',
        )
      }
      throw new ApiError(ERROR_CODES.PIPELINE_REPOSITORY_UNAVAILABLE, '仓库或 Git 连接不可用，请检查连接状态')
    }
    throw error
  }

  async function listAvailableRepositories(actor: SessionUser, projectId: string) {
    const repositories = await code.listProjectRepositories(actor, projectId)
    const available = repositories.filter((repository) => repository.status === 'available')
    if (available.length === 0) {
      throw new ApiError(ERROR_CODES.PIPELINE_REPOSITORY_UNAVAILABLE, '项目未关联可用仓库')
    }
    return available
  }

  async function resolveCommitSha(
    actor: SessionUser,
    projectId: string,
    repositoryId: string,
    ref: string,
  ): Promise<string> {
    let page: Awaited<ReturnType<PipelineCodePort['listRepositoryCommits']>>
    try {
      page = await code.listRepositoryCommits(actor, projectId, repositoryId, { ref, page: 1, pageSize: 1 })
    } catch (error) {
      repositoryReadFailed(error, 'commit')
    }
    const sha = page.items[0]?.sha?.toLowerCase()
    if (!sha || !/^[0-9a-f]{7,64}$/.test(sha)) {
      throw new ApiError(ERROR_CODES.PIPELINE_COMMIT_NOT_FOUND, '指定提交或 ref 不可达')
    }
    return sha
  }

  async function readWorkflowFile(
    actor: SessionUser,
    projectId: string,
    repositoryId: string,
    ref: string,
    path: string,
  ): Promise<{ content: string; truncated: boolean }> {
    try {
      const file = await code.getRepositoryFileAtRef(actor, projectId, repositoryId, ref, path)
      return { content: file.content, truncated: file.truncated }
    } catch (error) {
      repositoryReadFailed(error, 'workflow')
    }
  }

  /** 按工作流路径在项目已关联仓库中查找文件；P1 固定目录 `.devops/workflows/`。 */
  async function resolveWorkflowSource(
    actor: SessionUser,
    projectId: string,
    workflowPath: string,
    refInput: string,
  ): Promise<WorkflowSource> {
    if (!isPipelineWorkflowPath(workflowPath)) {
      throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '工作流路径必须位于 .devops/workflows/')
    }
    const ref = validateGitRef(refInput)
    const repositories = await listAvailableRepositories(actor, projectId)
    for (const repository of repositories) {
      let tree: Awaited<ReturnType<PipelineCodePort['listRepositoryTree']>>
      try {
        tree = await code.listRepositoryTree(actor, projectId, repository.id, ref)
      } catch (error) {
        if (error instanceof ApiError && error.code === ERROR_CODES.NOT_FOUND) continue
        repositoryReadFailed(error, 'commit')
      }
      const exists = tree.entries.some((entry) => entry.type === 'file' && entry.path === workflowPath)
      if (!exists) continue
      const file = await readWorkflowFile(actor, projectId, repository.id, ref, workflowPath)
      return {
        repositoryId: repository.id,
        repositoryFullName: `${repository.namespace}/${repository.name}`,
        ref: tree.branch,
        commitSha: await resolveCommitSha(actor, projectId, repository.id, ref),
        path: workflowPath,
        content: file.content,
        truncated: file.truncated,
      }
    }
    throw new ApiError(ERROR_CODES.PIPELINE_WORKFLOW_NOT_FOUND, '指定工作流文件不存在')
  }

  function ensureParsed(source: WorkflowSource): ParsedWorkflow {
    if (source.truncated) {
      throw new ApiError(ERROR_CODES.PIPELINE_WORKFLOW_PARSE_ERROR, '工作流文件超过读取上限', {
        path: source.path,
        issues: [{ code: 'WORKFLOW_PARSE_ERROR', message: '工作流文件超过读取上限', fieldPath: source.path }],
      })
    }
    const result = parseWorkflowFile({
      path: source.path,
      content: source.content,
      maxBytes: config.workflowMaxBytes,
    })
    if (result.ok) return result.workflow
    const first = result.issues[0]
    throw new ApiError(
      first ? mapWorkflowIssueCode(first.code) : ERROR_CODES.PIPELINE_WORKFLOW_SCHEMA_ERROR,
      first?.message ?? '工作流校验失败',
      { path: source.path, issues: result.issues.map(toParseErrorView) },
    )
  }

  async function runViewList(rows: Awaited<ReturnType<typeof findPipelineRuns>>['rows']): Promise<PipelineRunView[]> {
    const userIds = [...new Set(rows.map((row) => row.triggered_by_user_id))]
    const nodeIds = rows.flatMap((row) => (row.node_id === null ? [] : [row.node_id]))
    const [userRefs, nodes] = await Promise.all([
      loadUserRefs(db, userIds),
      findPipelineNodeSummariesByIds(db, nodeIds),
    ])
    const nodeNames = new Map(nodes.map((node) => [node.id, node.name]))
    const now = new Date()
    return rows.map((row) =>
      toPipelineRunView(row, {
        initiator: userNameOf(row.triggered_by_user_id, userRefs),
        nodeName: row.node_id === null ? null : (nodeNames.get(row.node_id) ?? null),
        now,
      }),
    )
  }

  async function loadRunDetail(runId: string): Promise<PipelineRunDetailView> {
    const row = await findPipelineRunById(db, runId)
    if (!row) throw new ApiError(ERROR_CODES.PIPELINE_RUN_NOT_FOUND, '流水线运行不存在')
    const [views, steps, artifacts, logStats, inputRow] = await Promise.all([
      runViewList([row]),
      findPipelineRunSteps(db, runId),
      findPipelineArtifacts(db, runId),
      aggregatePipelineRunLogs(db, runId),
      findPipelineRunInputs(db, runId),
    ])
    const view = views[0]
    if (!view) throw new ApiError(ERROR_CODES.PIPELINE_RUN_NOT_FOUND, '流水线运行不存在')
    const inputSummary: Record<string, string | number | boolean | null> = {}
    for (const [name, value] of Object.entries(inputRow?.inputs ?? {})) {
      if (typeof value === 'string') inputSummary[name] = maskInputValue(name, value)
      else if (typeof value === 'number' || typeof value === 'boolean') inputSummary[name] = value
    }
    const items = logStats.map(toPipelineRunLogStatView)
    return {
      ...view,
      inputs: inputSummary,
      steps: steps.map(toPipelineRunStepView),
      artifacts: artifacts.map(toPipelineArtifactView),
      logs: { items, totalSizeBytes: items.reduce((total, item) => total + item.sizeBytes, 0) },
    }
  }

  async function requireRunAccess(actor: SessionUser, runId: string, write: boolean) {
    const row = await findPipelineRunById(db, runId)
    if (!row) throw new ApiError(ERROR_CODES.PIPELINE_RUN_NOT_FOUND, '流水线运行不存在')
    await requireProject(actor, row.project_id, write)
    return row
  }

  async function listWorkflows(
    actor: SessionUser,
    projectId: string,
    refInput: string | undefined,
  ): Promise<PipelineWorkflowListView> {
    await requireProject(actor, projectId, false)
    const repositories = await listAvailableRepositories(actor, projectId)
    const repository = repositories[0]
    if (!repository) throw new ApiError(ERROR_CODES.PIPELINE_REPOSITORY_UNAVAILABLE, '项目未关联可用仓库')
    const ref = refInput ? validateGitRef(refInput) : validateGitRef(repository.defaultBranch ?? '')
    let tree: Awaited<ReturnType<PipelineCodePort['listRepositoryTree']>>
    try {
      tree = await code.listRepositoryTree(actor, projectId, repository.id, ref)
    } catch (error) {
      repositoryReadFailed(error, 'commit')
    }
    const workflowPaths = tree.entries
      .filter((entry) => entry.type === 'file' && isPipelineWorkflowPath(entry.path))
      .map((entry) => entry.path)
      .sort()
    const commitSha = await resolveCommitSha(actor, projectId, repository.id, ref)
    // 先读取最近运行，再逐个读取并解析文件；不能把依赖 lastRuns 的回调放进入参求值顺序不保证的表达式。
    const lastRuns = await findLatestRunsByWorkflowPaths(db, projectId, workflowPaths)
    const items = await Promise.all(
      workflowPaths.map(async (path): Promise<PipelineWorkflowItemView> => {
        const file = await readWorkflowFile(actor, projectId, repository.id, ref, path)
        const lastRunRow = lastRuns.get(path)
        const lastRun = lastRunRow
          ? { runId: lastRunRow.id, status: lastRunRow.status, createdAt: lastRunRow.created_at.toISOString() }
          : null
        if (file.truncated) {
          return {
            path,
            name: path.split('/').pop() ?? path,
            valid: false,
            parseErrors: [{ code: 'WORKFLOW_PARSE_ERROR', message: '工作流文件超过读取上限', fieldPath: path }],
            lastRun,
          }
        }
        const parsed = parseWorkflowFile({ path, content: file.content, maxBytes: config.workflowMaxBytes })
        if (parsed.ok) return { path, name: parsed.workflow.name, valid: true, parseErrors: [], lastRun }
        return {
          path,
          name: path.split('/').pop() ?? path,
          valid: false,
          parseErrors: parsed.issues.map(toParseErrorView),
          lastRun,
        }
      }),
    )
    return { ref: tree.branch, commitSha, items }
  }

  async function getWorkflowDetail(
    actor: SessionUser,
    projectId: string,
    pathInput: string,
    refInput: string | undefined,
  ): Promise<PipelineWorkflowDetailView> {
    await requireProject(actor, projectId, false)
    const workflowPath = pathInput.trim()
    if (!isPipelineWorkflowPath(workflowPath)) {
      throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '工作流路径必须位于 .devops/workflows/')
    }
    const repositories = await listAvailableRepositories(actor, projectId)
    const ref = refInput ? validateGitRef(refInput) : validateGitRef(repositories[0]?.defaultBranch ?? '')
    for (const repository of repositories) {
      let file: Awaited<ReturnType<PipelineCodePort['getRepositoryFileAtRef']>>
      try {
        file = await code.getRepositoryFileAtRef(actor, projectId, repository.id, ref, workflowPath)
      } catch (error) {
        if (error instanceof ApiError && error.code === ERROR_CODES.NOT_FOUND) continue
        repositoryReadFailed(error, 'workflow')
      }
      const commitSha = await resolveCommitSha(actor, projectId, repository.id, ref)
      const parsed = parseWorkflowFile({
        path: workflowPath,
        content: file.content,
        maxBytes: config.workflowMaxBytes,
      })
      const contentHash = hashWorkflowContent(file.content)
      const base = {
        path: workflowPath,
        repositoryId: repository.id,
        ref: file.branch,
        commitSha,
        content: file.content,
        contentHash,
      }
      if (parsed.ok) {
        return {
          ...base,
          name: parsed.workflow.name,
          valid: true,
          parseErrors: [],
          planSummary: summarizeWorkflowPlan(parsed.workflow),
          inputs: toWorkflowInputViews(parsed.workflow),
        }
      }
      return {
        ...base,
        name: workflowPath.split('/').pop() ?? workflowPath,
        valid: false,
        parseErrors: parsed.issues.map(toParseErrorView),
        planSummary: null,
        inputs: [],
      }
    }
    throw new ApiError(ERROR_CODES.PIPELINE_WORKFLOW_NOT_FOUND, '指定工作流文件不存在')
  }

  async function triggerRun(
    actor: SessionUser,
    projectId: string,
    input: TriggerPipelineRunInput,
  ): Promise<{ run: PipelineRunDetailView; created: boolean }> {
    const project = await requireProject(actor, projectId, true)
    const workflowPath = input.workflowPath.trim()
    const idempotencyKey = input.idempotencyKey.trim()
    if (idempotencyKey.length === 0 || idempotencyKey.length > 128) {
      throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '幂等键长度必须在 1-128 个字符之间')
    }
    const existing = await findPipelineRunByIdempotency(db, projectId, idempotencyKey)
    if (existing) return { run: await loadRunDetail(existing.id), created: false }
    const source = await resolveWorkflowSource(actor, projectId, workflowPath, input.ref)
    const workflow = ensureParsed(source)
    const runId = randomUUID()
    let template: RunPlanTemplate
    try {
      template = generateRunPlan({
        workflow,
        runId,
        ref: source.ref,
        commitSha: source.commitSha,
        inputs: input.inputs,
        github: { sha: source.commitSha, ref: source.ref, repository: source.repositoryFullName },
        defaultRunTimeoutSeconds: config.runTimeoutSeconds,
      })
    } catch (error) {
      if (error instanceof PipelinePlanError) {
        throw new ApiError(mapWorkflowIssueCode(error.code), error.message, {
          ...(error.path ? { path: error.path } : {}),
        })
      }
      throw error
    }
    const stepRows = template.jobs.flatMap((job) =>
      job.steps.map((step) => ({
        id: randomUUID(),
        teamId: project.teamId,
        projectId,
        runId,
        stepIndex: step.index,
        name: step.name,
        kind: step.kind,
        status: 'pending',
      })),
    )
    try {
      await db.transaction(async (tx) => {
        await insertPipelineRun(tx, {
          id: runId,
          teamId: project.teamId,
          projectId,
          repositoryId: source.repositoryId,
          workflowPath,
          workflowName: workflow.name,
          gitRef: source.ref,
          commitSha: source.commitSha,
          inputs: input.inputs,
          runPlan: template,
          workflowSnapshot: workflow.snapshot,
          workflowHash: workflow.hash,
          status: 'queued',
          triggerSource: 'manual',
          initiatorChannel: input.initiatorChannel,
          triggeredByUserId: actor.id,
          idempotencyKey,
          timeoutSeconds: template.timeoutSeconds,
        })
        await insertPipelineRunSteps(tx, stepRows)
        await appendPipelineActivity(tx, {
          teamId: project.teamId,
          projectId,
          entityType: 'pipeline_run',
          entityId: runId,
          action: 'pipeline_run_triggered',
          actorUserId: actor.id,
          changes: {
            workflowPath,
            ref: source.ref,
            commitSha: source.commitSha,
            repositoryId: source.repositoryId,
            inputKeys: Object.keys(input.inputs).slice(0, 20),
          },
        })
      })
    } catch (error) {
      if (!isUniqueViolation(error)) throw error
      const duplicated = await findPipelineRunByIdempotency(db, projectId, idempotencyKey)
      if (!duplicated) throw error
      return { run: await loadRunDetail(duplicated.id), created: false }
    }
    return { run: await loadRunDetail(runId), created: true }
  }

  async function listRuns(
    actor: SessionUser,
    projectId: string,
    filters: PipelineRunListFilters,
  ): Promise<PipelinePageView<PipelineRunView>> {
    await requireProject(actor, projectId, false)
    validatePage(filters.page, filters.pageSize)
    if (filters.status !== undefined && !isPipelineRunStatus(filters.status)) {
      throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '运行状态筛选不合法')
    }
    const { rows, total } = await findPipelineRuns(db, projectId, filters)
    const items = await runViewList(rows)
    return pipelinePageView(items, filters.page, filters.pageSize, total)
  }

  async function getRun(actor: SessionUser, runId: string): Promise<PipelineRunDetailView> {
    await requireRunAccess(actor, runId, false)
    return loadRunDetail(runId)
  }

  async function cancelRun(
    actor: SessionUser,
    runId: string,
    reasonInput: string | undefined,
  ): Promise<{ run: PipelineRunDetailView; created: boolean }> {
    const row = await requireRunAccess(actor, runId, true)
    if (isTerminalRunStatus(row.status)) {
      throw new ApiError(ERROR_CODES.PIPELINE_STATE_CONFLICT, '运行已结束，不能取消')
    }
    const reason = maskSensitiveText(reasonInput?.trim() ?? '')
    if (reason.length > 2000) throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '取消原因不能超过 2000 字符')
    if (row.status === 'cancelling') return { run: await loadRunDetail(runId), created: false }
    const cancelRequestedAt = new Date()
    // 已分配但已有活动租约的运行可能已被 Agent 开始执行，必须进入 cancelling 由节点确认；
    // 只有排队或“已分配未领取”的运行可以由平台直接收口为 cancelled。
    const activeLease = await findActivePipelineLeaseByRun(db, runId)
    const terminalDirectly = row.status === 'queued' || (row.status === 'assigned' && activeLease === undefined)
    const updated = await updatePipelineRunStatus(db, runId, [row.status], {
      status: terminalDirectly ? 'cancelled' : 'cancelling',
      cancelRequestedAt,
      cancelRequestedByUserId: actor.id,
      errorCode: 'CANCELLED',
      errorMessage: maskErrorMessage(reason),
      ...(terminalDirectly ? { finishedAt: cancelRequestedAt } : {}),
    })
    if (!updated) throw new ApiError(ERROR_CODES.PIPELINE_STATE_CONFLICT, '运行状态已变化，请刷新后重试')
    if (terminalDirectly) await skipPendingPipelineRunSteps(db, runId)
    await appendPipelineActivity(db, {
      teamId: updated.team_id,
      projectId: updated.project_id,
      entityType: 'pipeline_run',
      entityId: runId,
      action: 'pipeline_run_cancelled',
      actorUserId: actor.id,
      ...(reason.length > 0 ? { reason } : {}),
      changes: { previousStatus: row.status, status: updated.status },
    })
    return { run: await loadRunDetail(runId), created: false }
  }

  async function readLogs(
    actor: SessionUser,
    runId: string,
    input: ReadPipelineLogsInput,
  ): Promise<PipelineLogReadView> {
    await requireRunAccess(actor, runId, false)
    if (input.stepIndex !== undefined) {
      const step = await findPipelineRunStep(db, runId, input.stepIndex)
      if (!step) throw new ApiError(ERROR_CODES.PIPELINE_LOG_NOT_FOUND, '日志或步骤不存在')
    }
    const rows = await findPipelineRunLogs(db, runId, input.stepIndex, input.afterSeq, input.limit + 1)
    const hasMore = rows.length > input.limit
    const page = hasMore ? rows.slice(0, input.limit) : rows
    // 平台再次按运行引用的运行时密钥兜底脱敏；Agent 上传前已做一层。
    const knownSecrets = await loadLogSecrets(runId)
    const items = await Promise.all(
      page.map(async (row) => {
        const content = await storage.readLogChunk(row.storage_key)
        return { seq: row.seq, content: maskSensitiveText(content, knownSecrets), truncated: false }
      }),
    )
    const lastSeq = items.at(-1)?.seq
    return {
      stepIndex: input.stepIndex ?? null,
      items,
      nextSeq: lastSeq === undefined ? input.afterSeq : lastSeq,
      hasMore,
    }
  }

  async function listArtifacts(actor: SessionUser, runId: string): Promise<{ items: PipelineArtifactView[] }> {
    await requireRunAccess(actor, runId, false)
    const rows = await findPipelineArtifacts(db, runId)
    return { items: rows.map(toPipelineArtifactView) }
  }

  async function openArtifactDownload(actor: SessionUser, artifactId: string): Promise<PipelineArtifactDownload> {
    const row = await findPipelineArtifactById(db, artifactId)
    if (!row) throw new ApiError(ERROR_CODES.PIPELINE_ARTIFACT_NOT_FOUND, '产物不存在')
    await requireRunAccess(actor, row.run_id, false)
    if (row.status !== 'available') throw new ApiError(ERROR_CODES.PIPELINE_ARTIFACT_NOT_FOUND, '产物不可用')
    const artifact = toPipelineArtifactView(row)
    const run = await findPipelineRunById(db, row.run_id)
    if (run) {
      // 产物下载需要审计：记录操作者、产物标识与大小，不记录文件内容或下载地址参数。
      await appendPipelineActivity(db, {
        teamId: run.team_id,
        projectId: run.project_id,
        entityType: 'pipeline_run',
        entityId: run.id,
        action: 'pipeline_artifact_downloaded',
        actorUserId: actor.id,
        changes: { artifactId: row.id, name: row.name, sizeBytes: Number(row.size_bytes) },
      })
    }
    try {
      const opened = await storage.openArtifactStream(row.storage_key)
      return { artifact, stream: opened.stream, sizeBytes: opened.sizeBytes }
    } catch {
      throw new ApiError(ERROR_CODES.PIPELINE_STORAGE_ERROR, '产物文件读取失败')
    }
  }

  return {
    listWorkflows,
    getWorkflowDetail,
    triggerRun,
    listRuns,
    getRun,
    cancelRun,
    readLogs,
    listArtifacts,
    openArtifactDownload,
  }
}

export type PipelineService = ReturnType<typeof createPipelineService>
