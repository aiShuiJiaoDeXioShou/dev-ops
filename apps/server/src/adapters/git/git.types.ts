export type GitProvider = 'github' | 'gitea'
export type GitAuthKind = 'github_cli' | 'github_app_installation' | 'gitea_token'
export type GitObjectType = 'commit' | 'issue' | 'change_request'

export type GitErrorCode = 'timeout' | 'auth_failed' | 'not_found' | 'unavailable' | 'unsupported' | 'invalid_response'

/** Git 适配器错误；code 用于持久化与接口错误映射。 */
export class GitAdapterError extends Error {
  readonly code: GitErrorCode

  constructor(code: GitErrorCode, message: string) {
    super(message)
    this.name = 'GitAdapterError'
    this.code = code
  }
}

export interface GitRemoteRepository {
  remoteId: string
  namespace: string
  name: string
  webUrl: string
  defaultBranch: string | null
}

export interface GitObjectInput {
  repository: { namespace: string; name: string }
  objectType: GitObjectType
  remoteId: string
}

export interface GitObjectSnapshot {
  objectType: GitObjectType
  remoteId: string
  title: string
  state: string
  url: string | null
}

export interface GitConnectionIdentity {
  identity: string
}

export interface GitRepositoryRef {
  namespace: string
  name: string
}

export interface GitTreeEntry {
  path: string
  type: 'file' | 'directory'
  size: number | null
}

export interface GitFileContent {
  path: string
  content: string
  truncated: boolean
}

export interface GitTreeInput {
  repository: GitRepositoryRef
  ref: string
}

export interface GitFileInput extends GitTreeInput {
  path: string
}

/** 归一化后的 PR 状态；来源缺省或无法识别时为 unknown，不得猜测。 */
export type GitCodeState = 'open' | 'closed' | 'merged' | 'unknown'

/** 归一化后的 PR 评审状态；来源不提供评审信息时为 unknown。 */
export type GitReviewStatus = 'pending' | 'approved' | 'changes_requested' | 'unknown'

/** 归一化后的变更文件状态；提供方额外状态按可读语义收窄，无法识别时为 unknown。 */
export type GitFileChangeStatus = 'added' | 'modified' | 'removed' | 'renamed' | 'unknown'

/**
 * PR 列表的状态筛选。
 * 提供方 API 中 merged 属于 closed，合并结果由归一化状态表达，筛选不另设 merged。
 */
export type GitPullRequestFilterState = 'open' | 'closed' | 'all'

export interface GitCommitListInput {
  repository: GitRepositoryRef
  /** 分支、标签或提交标识；缺省由调用方改用仓库默认分支。 */
  ref?: string
  page: number
  pageSize: number
}

export interface GitCommitInput {
  repository: GitRepositoryRef
  ref: string
}

/** 归一化提交摘要，字段与接口提交列表项一致；不包含平台业务状态。 */
export interface GitCommitSummary {
  sha: string
  title: string
  authorName: string
  committedAt: string
  url: string | null
}

/** 提交变更文件摘要；不包含补丁，避免提交详情响应体过大。 */
export interface GitCommitFile {
  path: string
  status: GitFileChangeStatus
  additions: number
  deletions: number
}

/**
 * 提交详情。
 * files 为空时 filesUnsupported 表示来源不提供变更文件，filesTruncated 表示超过读取上限；
 * 列表中不区分“没有变更”与“未读取”，由接口层说明。
 */
export interface GitCommitDetail extends GitCommitSummary {
  files: GitCommitFile[]
  filesTruncated: boolean
  filesUnsupported: boolean
}

export interface GitPullRequestListInput {
  repository: GitRepositoryRef
  state?: GitPullRequestFilterState
  /** 来源作者名筛选；提供方列表接口不支持时由适配器在已读取页内过滤。 */
  author?: string
  page: number
  pageSize: number
}

export interface GitPullRequestInput {
  repository: GitRepositoryRef
  number: number
}

/** 归一化 PR 摘要；评审状态由详情读取或来源能力决定，不得凭空猜测。 */
export interface GitPullRequestSummary {
  number: number
  title: string
  authorName: string
  sourceBranch: string
  targetBranch: string
  state: GitCodeState
  reviewStatus: GitReviewStatus
  createdAt: string
  updatedAt: string
  mergedAt: string | null
  url: string | null
}

/** 归一化变更文件；patch 为 null 表示来源不提供（二进制或超限）。 */
export interface GitPullRequestFile {
  path: string
  status: GitFileChangeStatus
  additions: number
  deletions: number
  patch: string | null
  binary: boolean
  truncated: boolean
}

/** PR 详情；truncated 表示文件列表或补丁内容按来源能力被截断。 */
export interface GitPullRequestDetail extends GitPullRequestSummary {
  files: GitPullRequestFile[]
  truncated: boolean
}

/** 合并差异文本；达到大小上限时 truncated 为 true 且 patch 为前缀。 */
export interface GitPullRequestDiff {
  patch: string
  truncated: boolean
}

/** 提供方只读端口；业务模块不感知具体认证方式。 */
export interface GitAdapter {
  checkConnection(): Promise<GitConnectionIdentity>
  listRepositories(): Promise<GitRemoteRepository[]>
  getObject(input: GitObjectInput): Promise<GitObjectSnapshot>
  /** 读取仓库文件树；部分历史适配器测试替身可以不实现。 */
  listTree?(input: GitTreeInput): Promise<GitTreeEntry[]>
  /** 读取仓库文件内容；部分历史适配器测试替身可以不实现。 */
  getFile?(input: GitFileInput): Promise<GitFileContent>
  /** 读取仓库分支列表；部分历史适配器测试替身可以不实现。 */
  listBranches?(input: { repository: GitRepositoryRef }): Promise<string[]>
  /**
   * 读取提交列表；来源能力不支持时可以不实现，调用方映射为 EXTERNAL_UNSUPPORTED。
   * 返回当前页摘要，来源分页由 page/pageSize 控制，单页不超过 100 条。
   */
  listCommits?(input: GitCommitListInput): Promise<GitCommitSummary[]>
  /** 读取提交详情与变更文件；来源能力不支持时可以不实现，不存在时抛 not_found。 */
  getCommit?(input: GitCommitInput): Promise<GitCommitDetail>
  /**
   * 读取 PR 列表；来源能力不支持时可以不实现。
   * 列表不读取评审与变更文件，reviewStatus 在来源不提供时为 unknown。
   */
  listPullRequests?(input: GitPullRequestListInput): Promise<GitPullRequestSummary[]>
  /** 读取 PR 详情与变更文件；来源能力不支持时可以不实现，不存在时抛 not_found。 */
  getPullRequest?(input: GitPullRequestInput): Promise<GitPullRequestDetail>
  /** 读取 PR 合并差异文本；来源不提供差异时抛 unsupported，不返回空文本冒充成功。 */
  getPullRequestDiff?(input: GitPullRequestInput): Promise<GitPullRequestDiff>
}

/** 按提供方、授权方式和凭据构造适配器。 */
export interface GitAdapterInput {
  provider: GitProvider
  authKind: GitAuthKind
  instanceUrl: string
  allowedRepositories?: string[]
}
