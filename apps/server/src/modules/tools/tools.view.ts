import type { UserRef } from '../identity/identity.display.ts'
import { loadUserRefs } from '../identity/identity.display.ts'
import type { Database } from '../../platform/database/client.ts'
import { codeChange } from './tools.tables.ts'

type CodeChangeRow = typeof codeChange.$inferSelect

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
 * @param db 数据库连接。
 * @param row 代码变更行。
 * @param repositoryName 可选的仓库展示名；不传时只展示标识。
 * @returns 代码变更视图，不包含补丁正文。
 */
export async function toCodeChangeView(
  db: Database,
  row: CodeChangeRow,
  repositoryName: string | null = null,
): Promise<CodeChangeView> {
  const refs = await loadUserRefs(db, [row.created_by_user_id])
  return {
    id: row.id,
    projectId: row.project_id,
    repository: { id: row.repository_id, name: repositoryName },
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
    createdBy: refs.get(row.created_by_user_id) ?? null,
    createdAt: row.created_at.toISOString(),
    finishedAt: row.finished_at === null ? null : row.finished_at.toISOString(),
  }
}

/**
 * 批量转换代码变更行。
 * @param db 数据库连接。
 * @param rows 代码变更行数组。
 * @param repositoryNames 仓库标识到名称的映射。
 * @returns 代码变更视图数组。
 */
export async function toCodeChangeViews(
  db: Database,
  rows: CodeChangeRow[],
  repositoryNames: Map<string, string | null>,
): Promise<CodeChangeView[]> {
  return Promise.all(rows.map((row) => toCodeChangeView(db, row, repositoryNames.get(row.repository_id) ?? null)))
}
