import type { Database } from '../../platform/database/client.ts'
import { ApiError } from '../../platform/http/errors.ts'
import { ERROR_CODES } from '../../platform/http/error-codes.ts'
import { addComment } from '../collaboration/collaboration.service.ts'
import { requireTeamMember, type SessionUser } from '../identity/identity.session.ts'
import { findBugSummaryById } from '../bugs/bugs.repository.ts'
import { findRequirementSummaryById } from '../requirements/requirements.repository.ts'
import { requireToolCapabilityGrant } from './tools.capabilities.ts'
import {
  beginInvocation,
  buildRequestFingerprint,
  completeInvocation,
  markInvocationRunning,
  requireIdempotencyKey,
} from './tools.service.ts'

/** 远端写需要的代码模块端口；结构与 code.service 对应。 */
export interface ToolsRemoteCodePort {
  createRemoteIssue(
    actor: SessionUser,
    projectId: string,
    repositoryId: string,
    input: { title: string; body: string },
  ): Promise<{ number: number; url: string | null }>
  createReference(
    actor: SessionUser,
    projectId: string,
    input: {
      targetType: string
      targetId: string
      repositoryId: string
      objectType: string
      remoteId: string
    },
  ): Promise<unknown>
  addRemoteComment(
    actor: SessionUser,
    projectId: string,
    repositoryId: string,
    input: { targetType: 'issue' | 'pull_request'; targetNumber: number; body: string },
  ): Promise<{ id: string; url: string | null }>
}

/** 创建远端 Issue 输入。 */
export interface CreateRemoteIssueInput {
  idempotencyKey: string
  repositoryId: string
  bugId: string
  title: string
  body: string
}

/** 添加评论输入：本地事项或远端记录二选一。 */
export interface AddToolCommentInput {
  idempotencyKey: string
  targetType: 'requirement' | 'bug' | 'remote_issue' | 'remote_pull_request'
  targetId?: string
  repositoryId?: string
  remoteNumber?: number
  body: string
}

/**
 * 创建远端写能力用例。
 * @param deps 数据库与代码模块端口。
 * @returns 创建远端 Issue、关联本地 Bug、添加本地/远端评论。
 */
export function createRemoteWriteService(deps: { db: Database; code: ToolsRemoteCodePort }) {
  const { db, code } = deps

  /**
   * 创建远端 Issue 并关联本地 Bug。
   * @throws 缺能力、Bug/仓库不存在、重复创建或来源失败时抛出业务错误。
   */
  async function createRemoteIssue(
    actor: SessionUser,
    projectId: string,
    input: CreateRemoteIssueInput,
  ): Promise<{
    invocationId: string
    issue: { number: number; url: string | null }
  }> {
    const teamId = await requireToolCapabilityGrant(db, actor, projectId, 'create_issue')
    const bug = await findBugSummaryById(db, input.bugId)
    if (!bug || bug.projectId !== projectId) throw new ApiError(ERROR_CODES.NOT_FOUND, 'Bug 不存在')
    const title = input.title.trim()
    if (title.length === 0 || title.length > 200) {
      throw new ApiError(ERROR_CODES.VALIDATION_ERROR, 'Issue 标题长度必须在 1-200 字符之间')
    }
    const body = input.body.trim()
    if (body.length > 10_000) throw new ApiError(ERROR_CODES.VALIDATION_ERROR, 'Issue 正文不能超过 10000 字符')
    const invocation = await beginInvocation(db, {
      teamId,
      projectId,
      capability: 'create_issue',
      channel: 'cli',
      idempotencyKey: requireIdempotencyKey(input.idempotencyKey),
      requestFingerprint: buildRequestFingerprint({
        capability: 'create_issue',
        repositoryId: input.repositoryId,
        bugId: input.bugId,
        title,
      }),
      repositoryId: input.repositoryId,
      targetRef: input.bugId,
      inputSummary: { bugId: input.bugId, title },
      createdByUserId: actor.id,
    })
    if (invocation.replayed) {
      throw new ApiError(ERROR_CODES.REMOTE_WRITE_CONFLICT, '该请求已创建过远端 Issue，请刷新查看关联')
    }
    await markInvocationRunning(db, invocation.invocationId)
    try {
      const issue = await code.createRemoteIssue(actor, projectId, input.repositoryId, { title, body })
      await code.createReference(actor, projectId, {
        targetType: 'bug',
        targetId: input.bugId,
        repositoryId: input.repositoryId,
        objectType: 'issue',
        remoteId: String(issue.number),
      })
      await completeInvocation(db, invocation.invocationId, {
        status: 'succeeded',
        resultRef: { issueNumber: issue.number, url: issue.url },
      })
      return { invocationId: invocation.invocationId, issue }
    } catch (error) {
      await completeInvocation(db, invocation.invocationId, {
        status: 'failed',
        errorCode: error instanceof ApiError ? error.code : ERROR_CODES.EXTERNAL_UNAVAILABLE,
        errorMessage: '创建远端 Issue 失败',
      })
      throw error
    }
  }

  /**
   * 添加评论：本地事项写入平台评论，远端目标写入来源并回传引用。
   * @throws 缺能力、目标不存在、远端失败或参数非法时抛出业务错误。
   */
  async function addToolComment(
    actor: SessionUser,
    projectId: string,
    input: AddToolCommentInput,
  ): Promise<{
    invocationId: string
    comment: { id: string; url: string | null; createdAt: string }
  }> {
    const teamId = await requireToolCapabilityGrant(db, actor, projectId, 'add_comment')
    const body = input.body.trim()
    if (body.length === 0 || body.length > 5000) {
      throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '评论正文长度必须在 1-5000 字符之间')
    }
    if (input.targetType === 'requirement' || input.targetType === 'bug') {
      if (!input.targetId) throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '缺少评论目标')
      await requireTeamMember(db, actor.id, teamId)
      const target =
        input.targetType === 'requirement'
          ? await findRequirementSummaryById(db, input.targetId)
          : await findBugSummaryById(db, input.targetId)
      if (!target || target.projectId !== projectId) throw new ApiError(ERROR_CODES.NOT_FOUND, '评论目标不存在')
      const invocation = await beginInvocation(db, {
        teamId,
        projectId,
        capability: 'add_comment',
        channel: 'cli',
        idempotencyKey: requireIdempotencyKey(input.idempotencyKey),
        requestFingerprint: buildRequestFingerprint({
          capability: 'add_comment',
          targetType: input.targetType,
          targetId: input.targetId,
          body,
        }),
        targetRef: input.targetId,
        inputSummary: { targetType: input.targetType },
        createdByUserId: actor.id,
      })
      if (invocation.replayed) {
        throw new ApiError(ERROR_CODES.REMOTE_WRITE_CONFLICT, '该评论请求已提交过，请刷新查看')
      }
      await markInvocationRunning(db, invocation.invocationId)
      const comment = await addComment(db, {
        teamId,
        projectId,
        entityType: input.targetType,
        entityId: input.targetId,
        authorUserId: actor.id,
        bodyMarkdown: body,
      })
      await completeInvocation(db, invocation.invocationId, {
        status: 'succeeded',
        resultRef: { commentId: comment.id },
      })
      return {
        invocationId: invocation.invocationId,
        comment: { id: comment.id, url: null, createdAt: new Date().toISOString() },
      }
    }
    if (!input.repositoryId || !input.remoteNumber) {
      throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '远端评论需要仓库与记录编号')
    }
    const invocation = await beginInvocation(db, {
      teamId,
      projectId,
      capability: 'add_comment',
      channel: 'cli',
      idempotencyKey: requireIdempotencyKey(input.idempotencyKey),
      requestFingerprint: buildRequestFingerprint({
        capability: 'add_comment',
        targetType: input.targetType,
        repositoryId: input.repositoryId,
        remoteNumber: input.remoteNumber,
        body,
      }),
      repositoryId: input.repositoryId,
      targetRef: `${input.repositoryId}:${input.remoteNumber}`,
      inputSummary: { targetType: input.targetType, remoteNumber: input.remoteNumber },
      createdByUserId: actor.id,
    })
    if (invocation.replayed) {
      throw new ApiError(ERROR_CODES.REMOTE_WRITE_CONFLICT, '该评论请求已提交过，请刷新查看')
    }
    await markInvocationRunning(db, invocation.invocationId)
    try {
      const remote = await code.addRemoteComment(actor, projectId, input.repositoryId, {
        targetType: input.targetType === 'remote_issue' ? 'issue' : 'pull_request',
        targetNumber: input.remoteNumber,
        body,
      })
      await completeInvocation(db, invocation.invocationId, {
        status: 'succeeded',
        resultRef: { commentId: remote.id, url: remote.url },
      })
      return {
        invocationId: invocation.invocationId,
        comment: { id: remote.id, url: remote.url, createdAt: new Date().toISOString() },
      }
    } catch (error) {
      await completeInvocation(db, invocation.invocationId, {
        status: 'failed',
        errorCode: error instanceof ApiError ? error.code : ERROR_CODES.EXTERNAL_UNAVAILABLE,
        errorMessage: '添加远端评论失败',
      })
      throw error
    }
  }

  return { createRemoteIssue, addToolComment }
}

export type RemoteWriteService = ReturnType<typeof createRemoteWriteService>
