import type { AppConfig } from '../../platform/config/env.js'
import type { GitAdapter, GitAdapterInput } from './git.types.js'

export interface GitAdapterDependencies {
  githubCli?: (input: GitAdapterInput) => GitAdapter
  githubApp?: (input: GitAdapterInput) => GitAdapter
  gitea?: (input: GitAdapterInput) => GitAdapter
}

/**
 * 按运行时配置选择 Git 适配器；stg 使用 GitHub CLI，生产使用 GitHub App。
 * @param config 已校验配置，提供 GITHUB_AUTH_MODE 与允许仓库。
 * @param input 连接提供方、授权方式与实例地址。
 * @param deps 适配器工厂；测试可注入替身。
 * @returns 只读 Git 适配器。
 * @throws 不支持的提供方/授权组合或缺少必要依赖时抛出错误。
 */
export function createGitAdapter(config: AppConfig, input: GitAdapterInput, deps: GitAdapterDependencies): GitAdapter {
  const context = { ...input, allowedRepositories: config.GITHUB_ALLOWED_REPOS }
  if (input.provider === 'github') {
    const authKind = config.GITHUB_AUTH_MODE === 'cli' ? 'github_cli' : 'github_app_installation'
    if (input.authKind !== 'github_cli' && input.authKind !== 'github_app_installation') {
      throw new Error('GitHub 连接授权方式不合法')
    }
    const selected: GitAdapterInput =
      authKind === 'github_cli'
        ? { ...context, authKind: 'github_cli' }
        : { ...context, authKind: 'github_app_installation' }
    if (authKind === 'github_cli') {
      if (!deps.githubCli) throw new Error('GitHub CLI 适配器未装配')
      return deps.githubCli(selected)
    }
    if (!deps.githubApp) throw new Error('GitHub App 适配器未装配')
    return deps.githubApp(selected)
  }
  if (input.provider === 'gitea') {
    if (input.authKind !== 'gitea_token') throw new Error('Gitea 连接授权方式不合法')
    if (!deps.gitea) throw new Error('Gitea 适配器未装配')
    return deps.gitea({ ...context, authKind: 'gitea_token' })
  }
  throw new Error('不支持的 Git 提供方')
}
