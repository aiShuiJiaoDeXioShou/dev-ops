import { createHash, randomUUID } from 'node:crypto'
import { and, desc, eq, inArray, isNotNull, isNull, or } from 'drizzle-orm'
import type { Database } from '../../platform/database/client.ts'
import { ApiError } from '../../platform/http/errors.ts'
import { ERROR_CODES } from '../../platform/http/error-codes.ts'
import { loadUserRefs } from '../identity/identity.display.ts'
import type { SessionUser } from '../identity/identity.session.ts'
import {
  findPipelineArtifactByRunName,
  findPipelineRunById,
  findPipelineRunSteps,
} from '../pipeline/pipeline.repository.ts'
import { isTerminalRunStatus, PIPELINE_TERMINAL_RUN_STATUSES } from '../pipeline/pipeline.state.ts'
import { pipelineArtifact, pipelineRun } from '../pipeline/pipeline.tables.ts'
import { getProjectRoleContext, requireToolCapabilityGrant } from './tools.capabilities.ts'
import {
  beginInvocation,
  buildRequestFingerprint,
  completeInvocation,
  markInvocationRunning,
  requireIdempotencyKey,
} from './tools.service.ts'
import { codeChange } from './tools.tables.ts'
import { codeChangeViewColumns, toCodeChangeView, type CodeChangeView, type CodeChangeViewRow } from './tools.view.ts'

/** 代码修改依赖的流水线端口。 */
export interface ToolsPipelinePort {
  createCodeChangeRun(
    actor: SessionUser,
    projectId: string,
    input: {
      teamId: string
      codeChangeId: string
      repositoryId: string
      baseRef: string
      baseSha: string
      branchName: string
      commitMessage: string
      authorName: string
      authorEmail: string
      patch: string
      patchSha256: string
      validationWorkflowPath: string
      secretEnvironment: 'development' | 'test' | 'production'
      idempotencyKey: string
    },
  ): Promise<{ runId: string }>
  readRunArtifact(
    actor: SessionUser,
    runId: string,
    name: string,
    maxBytes?: number,
  ): Promise<{ content: string } | null>
  cancelRun(
    actor: SessionUser,
    runId: string,
    reason?: string,
  ): Promise<{ run: { runId: string; status: string }; created: boolean }>
}

/** 代码修改依赖的代码读取端口。 */
export interface ToolsCodePort {
  listProjectRepositories(
    actor: SessionUser,
    projectId: string,
  ): Promise<Array<{ id: string; namespace: string; name: string; defaultBranch: string | null }>>
  listRepositoryCommits(
    actor: SessionUser,
    projectId: string,
    repositoryId: string,
    input: { ref?: string; page?: number; pageSize?: number },
  ): Promise<{ items: Array<{ sha: string }> }>
  createPullRequest(
    actor: SessionUser,
    projectId: string,
    repositoryId: string,
    input: { title: string; body: string; sourceBranch: string; targetBranch: string },
  ): Promise<{ number: number; url: string | null; sourceBranch: string; targetBranch: string }>
}

/** 创建代码修改输入；补丁由客户端给出，服务端重新校验摘要与大小。 */
export interface CreateCodeChangeInput {
  idempotencyKey: string
  repositoryId: string
  baseRef: string
  branchName: string
  commitMessage: string
  patch: string
  patchSha256: string
  validationWorkflowPath: string
  secretEnvironment?: 'development' | 'test' | 'production'
}

const BRANCH_PATTERN = /^[A-Za-z0-9._/-]+$/
const SHA256_PATTERN = /^[0-9a-f]{64}$/
const COMMIT_SHA_PATTERN = /^[0-9a-f]{7,64}$/
const ACTIVE_CODE_CHANGE_STATUSES = ['queued', 'running']
const DIFF_ARTIFACT_NAME = 'code-change-diff'

function validateBranch(branchName: string, baseRef: string): string {
  const branch = branchName.trim()
  if (branch.length === 0 || branch.length > 200) {
    throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '工作分支长度必须在 1-200 字符之间')
  }
  if (!BRANCH_PATTERN.test(branch) || branch.startsWith('/') || branch.endsWith('/') || branch.includes('..')) {
    throw new ApiError(ERROR_CODES.CODE_CHANGE_INVALID_PATCH, '工作分支名不合法')
  }
  if (branch === baseRef.trim()) throw new ApiError(ERROR_CODES.CODE_CHANGE_CONFLICT, '工作分支不能与基线相同')
  return branch
}

/**
 * 校验补丁摘要、大小与分支；失败不写任何记录。
 * @returns 规范化后的补丁元数据。
 * @throws CODE_CHANGE_INVALID_PATCH 或 CODE_CHANGE_CONFLICT。
 */
export function validateCodeChangeInput(
  input: CreateCodeChangeInput,
  maxPatchBytes: number,
): {
  patchSha256: string
  patchSizeBytes: number
  branchName: string
  baseRef: string
} {
  const patch = input.patch
  if (patch.trim().length === 0) throw new ApiError(ERROR_CODES.CODE_CHANGE_INVALID_PATCH, '补丁不能为空')
  const patchSizeBytes = Buffer.byteLength(patch, 'utf8')
  if (patchSizeBytes > maxPatchBytes) {
    throw new ApiError(ERROR_CODES.CODE_CHANGE_INVALID_PATCH, `补丁超过 ${maxPatchBytes} 字节上限`)
  }
  const patchSha256 = createHash('sha256').update(patch, 'utf8').digest('hex')
  if (!SHA256_PATTERN.test(input.patchSha256) || patchSha256 !== input.patchSha256) {
    throw new ApiError(ERROR_CODES.CODE_CHANGE_INVALID_PATCH, '补丁摘要不一致，请重新提交')
  }
  const baseRef = input.baseRef.trim()
  if (baseRef.length === 0 || baseRef.length > 200) {
    throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '基线分支长度必须在 1-200 字符之间')
  }
  return {
    patchSha256,
    patchSizeBytes,
    branchName: validateBranch(input.branchName, baseRef),
    baseRef,
  }
}

/**
 * 创建受控代码修改用例。
 * @param deps 数据库、流水线与代码读取端口。
 * @returns 创建、查询、取消与差异读取用例。
 */
export function createCodeChangeService(deps: {
  db: Database
  pipeline: ToolsPipelinePort
  code: ToolsCodePort
  maxPatchBytes: number
  diffResponseMaxBytes: number
}) {
  const { db, pipeline, code } = deps

  async function syncStatus(row: CodeChangeViewRow) {
    if (!row.pipeline_run_id) return row
    const needsDiff = row.status === 'succeeded' && row.diff_sha256 === null
    if (!ACTIVE_CODE_CHANGE_STATUSES.includes(row.status) && !needsDiff) return row
    await reconcileCodeChangeFromRun(db, row.pipeline_run_id)
    // Worker 可能已经更新了该记录，重新读取以避免使用并发更新前的状态。
    return loadCodeChange(row.id)
  }

  /**
   * 读取代码变更的响应字段。
   * @param codeChangeId 代码变更标识。
   * @returns 代码变更投影。
   * @throws 记录不存在时抛出 CODE_CHANGE_NOT_FOUND。
   */
  async function loadCodeChange(codeChangeId: string) {
    const [row] = await db
      .select(codeChangeViewColumns)
      .from(codeChange)
      .where(eq(codeChange.id, codeChangeId))
      .limit(1)
    if (!row) throw new ApiError(ERROR_CODES.CODE_CHANGE_NOT_FOUND, '代码变更不存在')
    return row
  }

  async function viewOf(row: CodeChangeViewRow): Promise<CodeChangeView> {
    const refs = await loadUserRefs(db, [row.created_by_user_id])
    return toCodeChangeView(row, refs.get(row.created_by_user_id) ?? null)
  }

  /**
   * 创建代码变更：校验能力、幂等、补丁与基线，写入记录后创建平台运行。
   * @throws TOOL_CAPABILITY_NOT_GRANTED、CODE_CHANGE_INVALID_PATCH、CODE_CHANGE_CONFLICT。
   */
  async function createCodeChange(
    actor: SessionUser,
    projectId: string,
    input: CreateCodeChangeInput,
  ): Promise<{ codeChange: CodeChangeView; invocationId: string }> {
    const teamId = await requireToolCapabilityGrant(db, actor, projectId, 'code_change')
    const idempotencyKey = requireIdempotencyKey(input.idempotencyKey)
    const fields = validateCodeChangeInput(input, deps.maxPatchBytes)
    const repositories = await code.listProjectRepositories(actor, projectId)
    const repository = repositories.find((item) => item.id === input.repositoryId)
    if (!repository) throw new ApiError(ERROR_CODES.NOT_FOUND, '仓库不存在或未关联到项目')
    const commits = await code.listRepositoryCommits(actor, projectId, repository.id, {
      ref: fields.baseRef,
      page: 1,
      pageSize: 1,
    })
    const baseSha = commits.items[0]?.sha
    if (!baseSha || !COMMIT_SHA_PATTERN.test(baseSha)) {
      throw new ApiError(ERROR_CODES.CODE_CHANGE_CONFLICT, '基线分支或标签不存在')
    }
    const fingerprint = buildRequestFingerprint({
      capability: 'code_change',
      repositoryId: repository.id,
      baseRef: fields.baseRef,
      branchName: fields.branchName,
      commitMessage: input.commitMessage,
      patchSha256: fields.patchSha256,
      validationWorkflowPath: input.validationWorkflowPath,
    })
    const invocation = await beginInvocation(db, {
      teamId,
      projectId,
      capability: 'code_change',
      channel: 'cli',
      idempotencyKey,
      requestFingerprint: fingerprint,
      repositoryId: repository.id,
      inputSummary: {
        branchName: fields.branchName,
        baseRef: fields.baseRef,
        patchSha256: fields.patchSha256,
        patchSizeBytes: fields.patchSizeBytes,
      },
      createdByUserId: actor.id,
    })
    if (invocation.replayed) {
      const [existing] = await db
        .select()
        .from(codeChange)
        .where(eq(codeChange.invocation_id, invocation.invocationId))
        .limit(1)
      if (!existing) throw new ApiError(ERROR_CODES.CODE_CHANGE_NOT_FOUND, '重复请求的代码变更不存在')
      return { codeChange: await viewOf(await syncStatus(existing)), invocationId: invocation.invocationId }
    }
    const codeChangeId = randomUUID()
    await db.insert(codeChange).values({
      id: codeChangeId,
      team_id: teamId,
      project_id: projectId,
      repository_id: repository.id,
      invocation_id: invocation.invocationId,
      base_ref: fields.baseRef,
      base_sha: baseSha,
      branch_name: fields.branchName,
      commit_message: input.commitMessage.trim(),
      author_name: actor.name,
      author_email: actor.email,
      patch: input.patch,
      patch_sha256: fields.patchSha256,
      patch_size_bytes: fields.patchSizeBytes,
      validation_workflow_path: input.validationWorkflowPath,
      status: 'queued',
      created_by_user_id: actor.id,
    })
    try {
      const run = await pipeline.createCodeChangeRun(actor, projectId, {
        teamId,
        codeChangeId,
        repositoryId: repository.id,
        baseRef: fields.baseRef,
        baseSha,
        branchName: fields.branchName,
        commitMessage: input.commitMessage.trim(),
        authorName: actor.name,
        authorEmail: actor.email,
        patch: input.patch,
        patchSha256: fields.patchSha256,
        validationWorkflowPath: input.validationWorkflowPath,
        secretEnvironment: input.secretEnvironment ?? 'test',
        idempotencyKey: `code-change-${codeChangeId}`,
      })
      await db
        .update(codeChange)
        .set({ pipeline_run_id: run.runId, status: 'running', updated_at: new Date() })
        .where(eq(codeChange.id, codeChangeId))
      await markInvocationRunning(db, invocation.invocationId)
      await completeInvocation(db, invocation.invocationId, {
        status: 'succeeded',
        resultRef: { codeChangeId, pipelineRunId: run.runId },
      })
    } catch (error) {
      await db
        .update(codeChange)
        .set({
          status: 'failed',
          error_code: error instanceof ApiError ? error.code : ERROR_CODES.CODE_CHANGE_CONFLICT,
          error_message: '创建代码修改运行失败',
          finished_at: new Date(),
          updated_at: new Date(),
        })
        .where(eq(codeChange.id, codeChangeId))
      if (error instanceof ApiError) throw error
      throw new ApiError(ERROR_CODES.CODE_CHANGE_CONFLICT, '创建代码修改运行失败')
    }
    const created = await syncStatus(await loadCodeChange(codeChangeId))
    return { codeChange: await viewOf(created), invocationId: invocation.invocationId }
  }

  /**
   * 分页上限内读取项目代码变更及创建人。运行终态由后台回填。
   * @param actor 当前用户，须拥有项目读取权限。
   * @param projectId 项目标识。
   * @returns 按创建时间倒序排列的最近 50 条记录。
   * @throws 项目不存在或用户无权访问时抛出业务错误。
   */
  async function listCodeChanges(actor: SessionUser, projectId: string): Promise<CodeChangeView[]> {
    await getProjectRoleContext(db, actor, projectId)
    const rows = await db
      .select(codeChangeViewColumns)
      .from(codeChange)
      .where(eq(codeChange.project_id, projectId))
      .orderBy(desc(codeChange.created_at), codeChange.id)
      .limit(50)
    const refs = await loadUserRefs(
      db,
      rows.map((row) => row.created_by_user_id),
    )
    return rows.map((row) => toCodeChangeView(row, refs.get(row.created_by_user_id) ?? null))
  }

  /** 读取代码变更详情；项目成员可读。 */
  async function getCodeChange(actor: SessionUser, codeChangeId: string): Promise<CodeChangeView> {
    const row = await loadCodeChange(codeChangeId)
    await getProjectRoleContext(db, actor, row.project_id)
    return viewOf(row)
  }

  /** 读取差异文本；产物缺失时返回空内容并标记不可用。 */
  async function readDiff(
    actor: SessionUser,
    codeChangeId: string,
  ): Promise<{ content: string; truncated: boolean; sha256: string | null; sizeBytes: number | null }> {
    const row = await loadCodeChange(codeChangeId)
    await getProjectRoleContext(db, actor, row.project_id)
    if (!row.pipeline_run_id) throw new ApiError(ERROR_CODES.CODE_CHANGE_DIFF_UNAVAILABLE, '差异尚未生成')
    const artifact = await pipeline.readRunArtifact(actor, row.pipeline_run_id, DIFF_ARTIFACT_NAME, 524_288)
    if (!artifact) throw new ApiError(ERROR_CODES.CODE_CHANGE_DIFF_UNAVAILABLE, '差异产物不可用')
    const sizeBytes = Buffer.byteLength(artifact.content, 'utf8')
    const truncated = sizeBytes > deps.diffResponseMaxBytes
    return {
      content: truncated ? artifact.content.slice(0, deps.diffResponseMaxBytes) : artifact.content,
      truncated,
      sha256: createHash('sha256').update(artifact.content, 'utf8').digest('hex'),
      sizeBytes,
    }
  }

  /** 取消排队或运行中的代码变更；已终态返回冲突。 */
  async function cancelCodeChange(actor: SessionUser, codeChangeId: string, _reason?: string): Promise<void> {
    const row = await loadCodeChange(codeChangeId)
    await getProjectRoleContext(db, actor, row.project_id)
    if (row.status !== 'queued' && row.status !== 'running') {
      throw new ApiError(ERROR_CODES.INVALID_TRANSITION, '代码变更已结束，不能取消')
    }
    if (row.pipeline_run_id) {
      try {
        await deps.pipeline.cancelRun(actor, row.pipeline_run_id, _reason)
      } catch (error) {
        const code = error instanceof ApiError ? error.code : undefined
        if (code !== ERROR_CODES.PIPELINE_STATE_CONFLICT && code !== ERROR_CODES.PIPELINE_RUN_NOT_FOUND) throw error
      }
    }
    await db
      .update(codeChange)
      .set({ status: 'cancelled', finished_at: new Date(), updated_at: new Date() })
      .where(eq(codeChange.id, codeChangeId))
  }

  /**
   * 为已成功的代码变更加载 PR 创建：能力、状态、幂等与远端冲突检查。
   * @returns 远端 PR 与调用记录标识。
   * @throws 未授权、状态不满足、已创建 PR 或来源失败时抛出业务错误。
   */
  async function createPullRequestForCodeChange(
    actor: SessionUser,
    codeChangeId: string,
    input: { title: string; body: string; targetBranch?: string; idempotencyKey: string },
  ): Promise<{
    invocationId: string
    pullRequest: { number: number; url: string | null; sourceBranch: string; targetBranch: string }
  }> {
    const row = await loadCodeChange(codeChangeId)
    const teamId = await requireToolCapabilityGrant(db, actor, row.project_id, 'create_pull_request')
    const synced = await syncStatus(row)
    if (synced.status !== 'succeeded') {
      throw new ApiError(ERROR_CODES.CODE_CHANGE_STATE_CONFLICT, '代码变更尚未成功完成，不能创建 PR')
    }
    if (synced.pull_request_number !== null) {
      throw new ApiError(ERROR_CODES.CODE_CHANGE_STATE_CONFLICT, '该代码变更已创建 PR')
    }
    const title = input.title.trim()
    if (title.length === 0 || title.length > 200) {
      throw new ApiError(ERROR_CODES.VALIDATION_ERROR, 'PR 标题长度必须在 1-200 字符之间')
    }
    const targetBranch = (input.targetBranch ?? synced.base_ref).trim()
    const invocation = await beginInvocation(db, {
      teamId,
      projectId: row.project_id,
      capability: 'create_pull_request',
      channel: 'cli',
      idempotencyKey: requireIdempotencyKey(input.idempotencyKey),
      requestFingerprint: buildRequestFingerprint({
        capability: 'create_pull_request',
        codeChangeId,
        title,
        targetBranch,
      }),
      repositoryId: row.repository_id,
      targetRef: codeChangeId,
      inputSummary: { title, targetBranch, sourceBranch: synced.branch_name },
      createdByUserId: actor.id,
    })
    if (invocation.replayed) {
      const current = await loadCodeChange(codeChangeId)
      const currentSynced = await syncStatus(current)
      if (currentSynced.pull_request_number === null || currentSynced.pull_request_url === null) {
        throw new ApiError(ERROR_CODES.PULL_REQUEST_CONFLICT, '重复请求的 PR 不存在')
      }
      return {
        invocationId: invocation.invocationId,
        pullRequest: {
          number: currentSynced.pull_request_number,
          url: currentSynced.pull_request_url,
          sourceBranch: currentSynced.branch_name,
          targetBranch,
        },
      }
    }
    await markInvocationRunning(db, invocation.invocationId)
    try {
      const pullRequest = await code.createPullRequest(actor, row.project_id, row.repository_id, {
        title,
        body: input.body,
        sourceBranch: synced.branch_name,
        targetBranch,
      })
      await db
        .update(codeChange)
        .set({
          pull_request_number: pullRequest.number,
          pull_request_url: pullRequest.url,
          updated_at: new Date(),
        })
        .where(eq(codeChange.id, codeChangeId))
      await completeInvocation(db, invocation.invocationId, {
        status: 'succeeded',
        resultRef: { pullRequestNumber: pullRequest.number, url: pullRequest.url },
      })
      return { invocationId: invocation.invocationId, pullRequest }
    } catch (error) {
      await completeInvocation(db, invocation.invocationId, {
        status: 'failed',
        errorCode: error instanceof ApiError ? error.code : ERROR_CODES.PULL_REQUEST_CONFLICT,
        errorMessage: '创建远端 PR 失败',
      })
      throw error
    }
  }

  return {
    createCodeChange,
    listCodeChanges,
    getCodeChange,
    readDiff,
    cancelCodeChange,
    loadCodeChange,
    createPullRequestForCodeChange,
  }
}

export type CodeChangeService = ReturnType<typeof createCodeChangeService>

/**
 * 回填运行终态、校验结果和已登记的差异元数据。
 * @param db 数据库连接。
 * @param runId 流水线运行标识。
 * @returns 是否更新了代码变更记录；没有待回填内容时为 false。
 * @remarks 条件写入允许 Worker、终态回调及写操作并发触发；读取产物元数据无需打开文件。
 */
export async function reconcileCodeChangeFromRun(db: Database, runId: string): Promise<boolean> {
  const [change] = await db
    .select({ id: codeChange.id, status: codeChange.status, diffSha256: codeChange.diff_sha256 })
    .from(codeChange)
    .where(eq(codeChange.pipeline_run_id, runId))
    .limit(1)
  if (!change) return false
  const isActive = ACTIVE_CODE_CHANGE_STATUSES.includes(change.status)
  if (!isActive && (change.status !== 'succeeded' || change.diffSha256 !== null)) return false
  const run = await findPipelineRunById(db, runId)
  if (!run || !isTerminalRunStatus(run.status)) return false
  const artifact =
    run.status === 'succeeded' ? await findPipelineArtifactByRunName(db, runId, DIFF_ARTIFACT_NAME) : null
  const diff =
    artifact?.status === 'available'
      ? {
          diff_storage_key: artifact.storage_key,
          diff_sha256: artifact.sha256,
          diff_size_bytes: Number(artifact.size_bytes),
        }
      : null

  // 补齐旧记录或晚到的差异产物，不重新写入已经收口的业务状态。
  if (!isActive) {
    if (!diff) return false
    const [updated] = await db
      .update(codeChange)
      .set({ ...diff, updated_at: new Date() })
      .where(and(eq(codeChange.id, change.id), eq(codeChange.status, 'succeeded'), isNull(codeChange.diff_sha256)))
      .returning({ id: codeChange.id })
    return updated !== undefined
  }

  const status = run.status === 'succeeded' ? 'succeeded' : run.status === 'cancelled' ? 'cancelled' : 'failed'
  const steps = await findPipelineRunSteps(db, runId)
  const validationResult = {
    runStatus: run.status,
    errorCode: run.error_code,
    steps: steps.map((step) => ({
      name: step.name,
      kind: step.kind,
      status: step.status,
      errorCode: step.error_code,
      startedAt: step.started_at?.toISOString() ?? null,
      finishedAt: step.finished_at?.toISOString() ?? null,
    })),
    failedStepIndex: steps.find((step) => step.status === 'failed')?.step_index ?? null,
  }
  const [updated] = await db
    .update(codeChange)
    .set({
      status,
      finished_at: run.finished_at ?? new Date(),
      error_code: status === 'succeeded' ? null : (run.error_code ?? 'CODE_CHANGE_FAILED'),
      error_message: status === 'succeeded' ? null : '代码修改运行未成功结束',
      validation_result: validationResult,
      ...diff,
      updated_at: new Date(),
    })
    .where(and(eq(codeChange.id, change.id), inArray(codeChange.status, ACTIVE_CODE_CHANGE_STATUSES)))
    .returning({ id: codeChange.id })
  return updated !== undefined
}

/**
 * 重试终态回调漏写的记录和晚到的差异产物，每个 Worker 周期最多处理 20 条。
 * @param db 数据库连接。
 * @param onError 单条回填失败时的日志回调；下个周期可重试。
 * @returns 本周期的待回填记录处理完毕后完成。
 * @throws 无法查询待回填记录时向调用方传播数据库错误。
 */
export async function reconcilePendingCodeChanges(
  db: Database,
  onError: (runId: string, error: unknown) => void,
): Promise<void> {
  const runs = await db
    .select({ runId: pipelineRun.id })
    .from(codeChange)
    .innerJoin(pipelineRun, eq(pipelineRun.id, codeChange.pipeline_run_id))
    .leftJoin(
      pipelineArtifact,
      and(
        eq(pipelineArtifact.run_id, pipelineRun.id),
        eq(pipelineArtifact.name, DIFF_ARTIFACT_NAME),
        eq(pipelineArtifact.status, 'available'),
      ),
    )
    .where(
      or(
        and(
          inArray(codeChange.status, ACTIVE_CODE_CHANGE_STATUSES),
          inArray(pipelineRun.status, PIPELINE_TERMINAL_RUN_STATUSES),
        ),
        and(
          eq(codeChange.status, 'succeeded'),
          eq(pipelineRun.status, 'succeeded'),
          isNull(codeChange.diff_sha256),
          isNotNull(pipelineArtifact.id),
        ),
      ),
    )
    .orderBy(codeChange.updated_at, codeChange.id)
    .limit(20)
  for (const { runId } of runs) {
    try {
      await reconcileCodeChangeFromRun(db, runId)
    } catch (error) {
      onError(runId, error)
    }
  }
}
