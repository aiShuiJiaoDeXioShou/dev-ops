/** 测试用仓库摘要。 */
export interface FakeGitRepository {
  id: string
  owner: string
  name: string
  visibility: 'public' | 'private'
  defaultBranch: string
}

/** 测试用提交摘要。 */
export interface FakeGitCommit {
  sha: string
  summary: string
  url: string
  committedAt: string
}

/** 测试用 Issue 摘要。 */
export interface FakeGitIssue {
  number: number
  title: string
  state: 'open' | 'closed'
  url: string
}

/** 测试用 PR 摘要。 */
export interface FakeGitChangeRequest {
  number: number
  title: string
  state: 'open' | 'closed' | 'merged'
  sourceBranch: string
  targetBranch: string
  url: string
}

/** Git 读取替身数据集合；不涉及网络、凭据或平台业务状态。 */
export interface FakeGitData {
  repositories: FakeGitRepository[]
  commits?: FakeGitCommit[]
  issues?: FakeGitIssue[]
  changeRequests?: FakeGitChangeRequest[]
}

/**
 * 创建确定性的 Git 测试数据。
 * @returns 一个公开仓库、一个私有仓库及基础对象摘要。
 */
export function createFakeGitData(): FakeGitData {
  return {
    repositories: [
      { id: 'repo-public', owner: 'example', name: 'public-app', visibility: 'public', defaultBranch: 'main' },
      { id: 'repo-private', owner: 'example', name: 'private-service', visibility: 'private', defaultBranch: 'main' },
    ],
    commits: [
      {
        sha: '0123456789abcdef',
        summary: 'feat: add endpoint',
        url: 'https://github.com/example/public-app/commit/0123456789abcdef',
        committedAt: '2026-11-09T10:00:00Z',
      },
    ],
    issues: [{ number: 12, title: '登录失败', state: 'open', url: 'https://github.com/example/public-app/issues/12' }],
    changeRequests: [
      {
        number: 8,
        title: 'feat: login',
        state: 'open',
        sourceBranch: 'feat/login',
        targetBranch: 'main',
        url: 'https://github.com/example/public-app/pull/8',
      },
    ],
  }
}
