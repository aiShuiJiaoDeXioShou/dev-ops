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

/** 提供方只读端口；业务模块不感知具体认证方式。 */
export interface GitAdapter {
  checkConnection(): Promise<GitConnectionIdentity>
  listRepositories(): Promise<GitRemoteRepository[]>
  getObject(input: GitObjectInput): Promise<GitObjectSnapshot>
}

/** 按提供方、授权方式和凭据构造适配器。 */
export interface GitAdapterInput {
  provider: GitProvider
  authKind: GitAuthKind
  instanceUrl: string
  allowedRepositories?: string[]
}
