import {
  GitAdapterError,
  type GitCodeState,
  type GitCommitDetail,
  type GitCommitFile,
  type GitCommitSummary,
  type GitFileChangeStatus,
  type GitPullRequestDetail,
  type GitPullRequestFile,
  type GitPullRequestSummary,
  type GitReviewStatus,
} from './git.types.ts'

/**
 * 单次代码读取上限，与 research R1 的边界一致。
 * 限制分页、文件数量与差异体积，避免一次请求耗尽来源配额、内存或响应体。
 */
export const GIT_READ_LIMITS = {
  maxPageSize: 100,
  maxChangedFiles: 100,
  maxPatchBytes: 100 * 1024,
  maxDiffBytes: 1024 * 1024,
} as const

/** 收窄分页参数：单页最多 100 条，非法值回退到默认值，避免向来源发出越界请求。 */
export function normalizePageInput(input: { page: number; pageSize: number }): { page: number; pageSize: number } {
  const page = Number.isSafeInteger(input.page) && input.page > 0 ? input.page : 1
  const pageSize =
    Number.isSafeInteger(input.pageSize) && input.pageSize > 0
      ? Math.min(input.pageSize, GIT_READ_LIMITS.maxPageSize)
      : 20
  return { page, pageSize }
}

/**
 * 归一化 PR 状态。
 * @param rawState 来源返回的原始状态。
 * @param merged 来源是否标记为已合并。
 * @returns 合并优先于关闭；来源缺省时返回 unknown，不猜测。
 */
export function normalizePullRequestState(rawState: unknown, merged: boolean): GitCodeState {
  if (merged) return 'merged'
  if (rawState === 'open') return 'open'
  if (rawState === 'closed') return 'closed'
  return 'unknown'
}

/**
 * 归一化变更文件状态。
 * @param rawStatus 来源返回的原始状态。
 * @returns 固定枚举；copied 视为新增、changed/unchanged 视为修改，其余为 unknown。
 */
export function normalizeFileChangeStatus(rawStatus: unknown): GitFileChangeStatus {
  if (isFileChangeStatus(rawStatus)) return rawStatus
  if (rawStatus === 'copied') return 'added'
  if (rawStatus === 'changed' || rawStatus === 'unchanged') return 'modified'
  return 'unknown'
}

/** 评审人对一次评审的有效结论；comment 与 pending 不参与评审状态推导。 */
export type GitReviewDecision = 'approved' | 'changes_requested' | 'dismissed' | 'none'

/** 归一化后的评审事实；reviewer 相同则按时间取最新一次。 */
export interface GitReviewFact {
  reviewer: string
  decision: GitReviewDecision
  submittedAt: string | null
}

/**
 * 推导 PR 评审状态。
 * @param facts 来源返回的评审事实列表，允许乱序。
 * @returns 每个评审人只保留最新有效结论：存在待修改为 changes_requested，
 * 否则存在通过为 approved，否则为 pending；来源不支持时由调用方直接使用 unknown。
 */
export function aggregateReviewStatus(facts: GitReviewFact[]): GitReviewStatus {
  const latestByReviewer = new Map<string, GitReviewFact>()
  for (const fact of facts) {
    if (fact.decision === 'none' || fact.decision === 'dismissed') continue
    const current = latestByReviewer.get(fact.reviewer)
    if (!current || compareTimestamps(fact.submittedAt, current.submittedAt) >= 0) {
      latestByReviewer.set(fact.reviewer, fact)
    }
  }
  const decisions = [...latestByReviewer.values()]
  if (decisions.some((fact) => fact.decision === 'changes_requested')) return 'changes_requested'
  if (decisions.some((fact) => fact.decision === 'approved')) return 'approved'
  return 'pending'
}

/**
 * 截取 UTF-8 字符串前缀。
 * @param text 待截断文本。
 * @param maxBytes 允许的最大 UTF-8 字节数。
 * @returns 不超过上限的前缀；在字符中间截断时去掉末尾替换字符，避免展示乱码。
 */
export function truncateUtf8Prefix(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return text
  return Buffer.from(text, 'utf8')
    .subarray(0, maxBytes)
    .toString('utf8')
    .replace(/\uFFFD+$/, '')
}

/**
 * 截断合并差异文本。
 * @param text 来源返回的完整差异文本。
 * @returns 前缀与截断标记；不超过 1MB 时原样返回。
 */
export function truncateDiffText(text: string): { patch: string; truncated: boolean } {
  if (Buffer.byteLength(text, 'utf8') <= GIT_READ_LIMITS.maxDiffBytes) return { patch: text, truncated: false }
  return { patch: truncateUtf8Prefix(text, GIT_READ_LIMITS.maxDiffBytes), truncated: true }
}

/**
 * 组装提交详情与变更文件。
 * @param summary 已归一化的提交摘要。
 * @param rawFiles 来源返回的原始 files 字段。
 * @param readFile 把原始文件解析为归一化提交文件。
 * @returns 提交详情；来源不提供 files 时用 filesUnsupported 标记，超过 100 个文件时截断并标记。
 */
export function buildCommitDetail(
  summary: GitCommitSummary,
  rawFiles: unknown,
  readFile: (raw: unknown) => GitCommitFile,
): GitCommitDetail {
  if (!Array.isArray(rawFiles)) {
    return { ...summary, files: [], filesTruncated: false, filesUnsupported: true }
  }
  const files = rawFiles.map(readFile)
  return {
    ...summary,
    files: files.slice(0, GIT_READ_LIMITS.maxChangedFiles),
    filesTruncated: files.length > GIT_READ_LIMITS.maxChangedFiles,
    filesUnsupported: false,
  }
}

/**
 * 按来源作者名过滤 PR 列表。
 * @param items 已读取的 PR 摘要。
 * @param author 作者名关键词；为空时原样返回。
 * @returns 作者名包含关键词（不区分大小写）的 PR。
 * @remarks GitHub/Gitea 的 PR 列表接口都不支持作者过滤，只能在已读取页内过滤，
 * 因此该条件下的分页与总数是近似值。
 */
export function filterPullRequestsByAuthor(
  items: GitPullRequestSummary[],
  author: string | undefined,
): GitPullRequestSummary[] {
  const keyword = author?.trim().toLowerCase()
  if (!keyword) return items
  return items.filter((item) => item.authorName.toLowerCase().includes(keyword))
}

/**
 * 限制 PR 变更文件的规模并标记截断。
 * @param files 已归一化的变更文件，可能超过上限。
 * @param sourceHasMore 来源是否还有未读取的文件，用于标记来源侧截断。
 * @returns 最多 100 个文件；超限文件被丢弃，超限补丁置为前缀或 null，并统一标记 truncated。
 */
export function finalizePullRequestFiles(
  files: GitPullRequestFile[],
  sourceHasMore = false,
): { files: GitPullRequestFile[]; truncated: boolean } {
  const limited = files.slice(0, GIT_READ_LIMITS.maxChangedFiles)
  let truncated = sourceHasMore || files.length > GIT_READ_LIMITS.maxChangedFiles
  let usedPatchBytes = 0
  const normalizedFiles = limited.map((file) => {
    if (file.patch === null) return file
    const patchBytes = Buffer.byteLength(file.patch, 'utf8')
    if (patchBytes > GIT_READ_LIMITS.maxPatchBytes) {
      truncated = true
      return { ...file, patch: truncateUtf8Prefix(file.patch, GIT_READ_LIMITS.maxPatchBytes), truncated: true }
    }
    if (usedPatchBytes + patchBytes > GIT_READ_LIMITS.maxDiffBytes) {
      truncated = true
      return { ...file, patch: null, truncated: true }
    }
    usedPatchBytes += patchBytes
    return file
  })
  return { files: normalizedFiles, truncated }
}

/**
 * 组装 PR 详情；文件超限或来源还有更多文件时标记截断。
 * @param summary 已归一化的 PR 摘要。
 * @param rawFiles 来源返回的原始变更文件列表。
 * @param readFiles 把原始文件解析为归一化文件。
 * @param sourceHasMore 来源是否还有未读取的文件。
 * @returns PR 详情视图。
 */
export function buildPullRequestDetail(
  summary: GitPullRequestSummary,
  rawFiles: unknown[],
  readFiles: (raw: unknown) => GitPullRequestFile,
  sourceHasMore = false,
): GitPullRequestDetail {
  const files = rawFiles.map(readFiles)
  return { ...summary, ...finalizePullRequestFiles(files, sourceHasMore) }
}

/** 解析 GitHub REST 提交对象。 */
export function parseGitHubCommit(raw: unknown): GitCommitSummary {
  const record = requireRecord(raw, 'GitHub 提交')
  const commit = isRecord(record.commit) ? record.commit : {}
  const author = isRecord(commit.author) ? commit.author : {}
  const committer = isRecord(commit.committer) ? commit.committer : {}
  return {
    sha: requireText(record.sha, 'sha'),
    title: firstLine(toText(commit.message)),
    authorName: toText(author.name) || toText(committer.name),
    committedAt: requireTimestamp(author.date ?? committer.date, 'commit.author.date'),
    url: optionalText(record.html_url),
  }
}

/** 解析 GitHub REST 提交变更文件对象；只保留数量信息，不返回补丁。 */
export function parseGitHubCommitFile(raw: unknown): GitCommitFile {
  const record = requireRecord(raw, 'GitHub 提交文件')
  return parseCommitFile({
    path: requireText(record.filename, 'filename'),
    status: normalizeFileChangeStatus(record.status),
    additions: toCount(record.additions),
    deletions: toCount(record.deletions),
  })
}

/** 解析 GitHub REST 提交详情，包含来源在 files 字段返回的变更文件。 */
export function parseGitHubCommitDetail(raw: unknown): GitCommitDetail {
  const record = requireRecord(raw, 'GitHub 提交')
  return buildCommitDetail(parseGitHubCommit(record), record.files, parseGitHubCommitFile)
}

/**
 * 解析 GitHub REST PR 对象。
 * @param raw 来源返回的 PR 对象。
 * @param reviewStatus 评审状态；列表接口不读取评审，默认 unknown。
 * @returns 归一化 PR 摘要。
 */
export function parseGitHubPullRequest(raw: unknown, reviewStatus: GitReviewStatus = 'unknown'): GitPullRequestSummary {
  const record = requireRecord(raw, 'GitHub PR')
  const user = isRecord(record.user) ? record.user : {}
  const head = isRecord(record.head) ? record.head : {}
  const base = isRecord(record.base) ? record.base : {}
  const mergedAt = optionalTimestamp(record.merged_at)
  return {
    number: requireNumber(record.number, 'number'),
    title: toText(record.title),
    authorName: toText(user.login),
    sourceBranch: toText(head.ref),
    targetBranch: toText(base.ref),
    state: normalizePullRequestState(record.state, mergedAt !== null),
    reviewStatus,
    createdAt: requireTimestamp(record.created_at, 'created_at'),
    updatedAt: requireTimestamp(record.updated_at, 'updated_at'),
    mergedAt,
    url: optionalText(record.html_url),
  }
}

/** 解析 GitHub REST 变更文件对象。 */
export function parseGitHubPullRequestFile(raw: unknown): GitPullRequestFile {
  const record = requireRecord(raw, 'GitHub 变更文件')
  return buildPullRequestFile({
    path: requireText(record.filename, 'filename'),
    status: normalizeFileChangeStatus(record.status),
    additions: toCount(record.additions),
    deletions: toCount(record.deletions),
    patch: typeof record.patch === 'string' ? record.patch : null,
  })
}

/** 解析 GitHub REST 评审对象。 */
export function parseGitHubReviewFact(raw: unknown): GitReviewFact {
  const record = requireRecord(raw, 'GitHub 评审')
  const user = isRecord(record.user) ? record.user : {}
  return {
    reviewer: toText(user.login) || String(record.id ?? ''),
    decision: toGitHubReviewDecision(record.state),
    submittedAt: optionalTimestamp(record.submitted_at),
  }
}

/** 解析 Gitea 提交对象；兼容 commit 内时间或顶层 created 字段。 */
export function parseGiteaCommit(raw: unknown): GitCommitSummary {
  const record = requireRecord(raw, 'Gitea 提交')
  const commit = isRecord(record.commit) ? record.commit : {}
  const author = isRecord(commit.author) ? commit.author : {}
  const committer = isRecord(commit.committer) ? commit.committer : {}
  return {
    sha: requireText(record.sha, 'sha'),
    title: firstLine(toText(commit.message)),
    authorName: toText(author.name) || toText(committer.name),
    committedAt: requireTimestamp(author.date ?? committer.date ?? record.created, 'commit.author.date'),
    url: optionalText(record.html_url),
  }
}

/**
 * 解析 Gitea PR 对象。
 * @param raw 来源返回的 PR 对象。
 * @param reviewStatus 评审状态；列表接口不读取评审，默认 unknown。
 * @returns 归一化 PR 摘要。
 */
export function parseGiteaPullRequest(raw: unknown, reviewStatus: GitReviewStatus = 'unknown'): GitPullRequestSummary {
  const record = requireRecord(raw, 'Gitea PR')
  const user = isRecord(record.user) ? record.user : {}
  const head = isRecord(record.head) ? record.head : {}
  const base = isRecord(record.base) ? record.base : {}
  const mergedAt = optionalTimestamp(record.merged_at)
  const isMerged = record.merged === true || mergedAt !== null
  return {
    number: requireNumber(record.number, 'number'),
    title: toText(record.title),
    authorName: toText(user.login),
    sourceBranch: toText(head.ref),
    targetBranch: toText(base.ref),
    state: normalizePullRequestState(record.state, isMerged),
    reviewStatus,
    createdAt: requireTimestamp(record.created_at, 'created_at'),
    updatedAt: requireTimestamp(record.updated_at, 'updated_at'),
    mergedAt,
    url: optionalText(record.html_url),
  }
}

/** 解析 Gitea 变更文件对象；旧版本可能不返回 status，此时归一化为 unknown。 */
export function parseGiteaPullRequestFile(raw: unknown): GitPullRequestFile {
  const record = requireRecord(raw, 'Gitea 变更文件')
  return buildPullRequestFile({
    path: requireText(record.filename, 'filename'),
    status: normalizeFileChangeStatus(record.status),
    additions: toCount(record.additions),
    deletions: toCount(record.deletions),
    patch: typeof record.patch === 'string' ? record.patch : null,
  })
}

/** 解析 Gitea 提交变更文件对象；旧版本不返回 status 时归一化为 unknown。 */
export function parseGiteaCommitFile(raw: unknown): GitCommitFile {
  const record = requireRecord(raw, 'Gitea 提交文件')
  return parseCommitFile({
    path: requireText(record.filename, 'filename'),
    status: normalizeFileChangeStatus(record.status),
    additions: toCount(record.additions),
    deletions: toCount(record.deletions),
  })
}

/**
 * 解析 Gitea 提交详情。
 * 不同版本对 files 字段支持不一致：不返回时用 filesUnsupported 标记，不伪造空文件列表。
 */
export function parseGiteaCommitDetail(raw: unknown): GitCommitDetail {
  const record = requireRecord(raw, 'Gitea 提交')
  return buildCommitDetail(parseGiteaCommit(record), record.files, parseGiteaCommitFile)
}

/** 解析 Gitea 评审对象；dismissed 优先于评审结论。 */
export function parseGiteaReviewFact(raw: unknown): GitReviewFact {
  const record = requireRecord(raw, 'Gitea 评审')
  const user = isRecord(record.user) ? record.user : isRecord(record.reviewer) ? record.reviewer : {}
  return {
    reviewer: toText(user.login) || String(record.id ?? ''),
    decision: record.dismissed === true ? 'dismissed' : toGiteaReviewDecision(record.state),
    submittedAt: optionalTimestamp(record.submitted_at),
  }
}

function isFileChangeStatus(value: unknown): value is GitFileChangeStatus {
  return value === 'added' || value === 'modified' || value === 'removed' || value === 'renamed'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new GitAdapterError('invalid_response', `${label}数据不合法`)
  return value
}

function toText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function optionalText(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function requireText(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new GitAdapterError('invalid_response', `Git 来源缺少字段：${field}`)
  }
  return value
}

function requireNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new GitAdapterError('invalid_response', `Git 来源字段不合法：${field}`)
  }
  return value
}

function toCount(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0
}

function requireTimestamp(value: unknown, field: string): string {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    throw new GitAdapterError('invalid_response', `Git 来源时间字段不合法：${field}`)
  }
  return value
}

function optionalTimestamp(value: unknown): string | null {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : null
}

function firstLine(message: string): string {
  return message.split(/\r?\n/, 1)[0] ?? ''
}

function compareTimestamps(left: string | null, right: string | null): number {
  const leftValue = left ?? ''
  const rightValue = right ?? ''
  if (leftValue === rightValue) return 0
  return leftValue < rightValue ? -1 : 1
}

function parseCommitFile(input: {
  path: string
  status: GitFileChangeStatus
  additions: number
  deletions: number
}): GitCommitFile {
  return input
}

function buildPullRequestFile(input: {
  path: string
  status: GitFileChangeStatus
  additions: number
  deletions: number
  patch: string | null
}): GitPullRequestFile {
  // 来源对二进制文件不返回补丁；此时增删行也为 0，可据此区分“二进制”与“超大文本截断”。
  const isBinary = input.patch === null && input.additions === 0 && input.deletions === 0
  return { ...input, binary: isBinary, truncated: false }
}

function toGitHubReviewDecision(state: unknown): GitReviewDecision {
  if (state === 'APPROVED') return 'approved'
  if (state === 'CHANGES_REQUESTED') return 'changes_requested'
  if (state === 'DISMISSED') return 'dismissed'
  return 'none'
}

function toGiteaReviewDecision(state: unknown): GitReviewDecision {
  if (state === 'APPROVED') return 'approved'
  if (state === 'REQUEST_CHANGES') return 'changes_requested'
  return 'none'
}
