import type { UserRef } from '../identity/identity.display.ts'
import { codeChange } from './tools.tables.ts'

/** 代码变更读取所需字段，补丁正文只用于创建运行。 */
export const codeChangeViewColumns = {
  id: codeChange.id,
  project_id: codeChange.project_id,
  repository_id: codeChange.repository_id,
  base_ref: codeChange.base_ref,
  base_sha: codeChange.base_sha,
  branch_name: codeChange.branch_name,
  commit_message: codeChange.commit_message,
  patch_sha256: codeChange.patch_sha256,
  patch_size_bytes: codeChange.patch_size_bytes,
  validation_workflow_path: codeChange.validation_workflow_path,
  status: codeChange.status,
  pipeline_run_id: codeChange.pipeline_run_id,
  validation_result: codeChange.validation_result,
  pull_request_number: codeChange.pull_request_number,
  pull_request_url: codeChange.pull_request_url,
  diff_sha256: codeChange.diff_sha256,
  diff_size_bytes: codeChange.diff_size_bytes,
  error_code: codeChange.error_code,
  error_message: codeChange.error_message,
  created_by_user_id: codeChange.created_by_user_id,
  created_at: codeChange.created_at,
  finished_at: codeChange.finished_at,
}

export type CodeChangeViewRow = Pick<typeof codeChange.$inferSelect, keyof typeof codeChangeViewColumns>

/** 受控代码修改视图；不返回补丁正文，只返回摘要与结果引用。 */
export interface CodeChangeView {
  id: string
  projectId: string
  repository: { id: string; name: string | null }
  baseRef: string
  baseSha: string
  branchName: string
  commitMessage: string
  patchSha256: string
  patchSizeBytes: number
  validationWorkflowPath: string
  status: string
  pipelineRunId: string | null
  validation: Record<string, unknown> | null
  pullRequest: { number: number | null; url: string | null } | null
  diff: { sha256: string | null; sizeBytes: number | null; truncated: boolean } | null
  errorCode: string | null
  errorMessage: string | null
  createdBy: UserRef | null
  createdAt: string
  finishedAt: string | null
}

/**
 * 代码变更行转视图。
 * @param row 代码变更行。
 * @param createdBy 批量加载的创建人引用；记录缺失时为 null。
 * @returns 代码变更视图，不包含补丁正文。
 */
export function toCodeChangeView(row: CodeChangeViewRow, createdBy: UserRef | null): CodeChangeView {
  return {
    id: row.id,
    projectId: row.project_id,
    repository: { id: row.repository_id, name: null },
    baseRef: row.base_ref,
    baseSha: row.base_sha,
    branchName: row.branch_name,
    commitMessage: row.commit_message,
    patchSha256: row.patch_sha256,
    patchSizeBytes: row.patch_size_bytes,
    validationWorkflowPath: row.validation_workflow_path,
    status: row.status,
    pipelineRunId: row.pipeline_run_id,
    validation: row.validation_result,
    pullRequest:
      row.pull_request_number === null ? null : { number: row.pull_request_number, url: row.pull_request_url },
    diff:
      row.diff_sha256 === null
        ? null
        : {
            sha256: row.diff_sha256,
            sizeBytes: row.diff_size_bytes,
            truncated: false,
          },
    errorCode: row.error_code,
    errorMessage: row.error_message,
    createdBy,
    createdAt: row.created_at.toISOString(),
    finishedAt: row.finished_at === null ? null : row.finished_at.toISOString(),
  }
}
