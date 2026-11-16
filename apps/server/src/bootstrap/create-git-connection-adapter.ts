import { readFile } from 'node:fs/promises'
import { createGitAdapter } from '../adapters/git/git.registry.ts'
import type { GitAdapter } from '../adapters/git/git.types.ts'
import { createGitHubCliAdapter } from '../adapters/git/github-cli.adapter.ts'
import { createGitHubAppAdapter } from '../adapters/git/github.adapter.ts'
import { createGiteaAdapter } from '../adapters/git/gitea.adapter.ts'
import type { SecretCipher } from '../modules/configuration/configuration.crypto.ts'
import { decryptConfiguredSecret } from '../modules/configuration/configuration.service.ts'
import type { gitConnection } from '../modules/integrations/integrations.tables.ts'
import type { AppConfig } from '../platform/config/env.ts'
import type { Database } from '../platform/database/client.ts'

type Connection = Pick<
  typeof gitConnection.$inferSelect,
  'provider_key' | 'auth_kind' | 'instance_url' | 'team_id' | 'secret_id' | 'external_identity'
>

/**
 * 组装 API 和 Worker 共用的 Git 连接适配器工厂。
 * @param deps 应用配置、凭据数据库与可选加解密器。
 * @returns 将已核对归属的连接转为固定提供方适配器的函数；授权配置不合法时拒绝。
 */
export function createGitConnectionAdapterFactory(deps: {
  config: AppConfig
  db: Database
  cipher: SecretCipher | null
}) {
  const { config, db, cipher } = deps
  return async function buildGitAdapter(connection: Connection): Promise<GitAdapter> {
    const { provider_key: provider, auth_kind: authKind, instance_url: instanceUrl } = connection
    if (provider === 'gitea') {
      if (authKind !== 'gitea_token') throw new Error('数据库中的 Gitea 连接授权方式不合法')
      if (!cipher || !connection.secret_id) throw new Error('Gitea 凭据未配置')
      const token = await decryptConfiguredSecret(db, cipher, connection.team_id, connection.secret_id)
      return createGitAdapter(
        config,
        { provider, authKind, instanceUrl },
        {
          gitea: (selected) => createGiteaAdapter({ ...selected, token }),
        },
      )
    }
    if (provider !== 'github') throw new Error('数据库中的 Git 提供方不合法')
    if (authKind === 'github_cli') {
      return createGitAdapter(config, { provider, authKind, instanceUrl }, { githubCli: createGitHubCliAdapter })
    }
    if (authKind !== 'github_app_installation') throw new Error('数据库中的 GitHub 连接授权方式不合法')
    const { GITHUB_APP_ID: appId, GITHUB_APP_PRIVATE_KEY_PATH: keyPath } = config
    if (!appId || !keyPath) throw new Error('GitHub App 凭据未配置')
    const installationId = Number(connection.external_identity)
    if (!Number.isSafeInteger(installationId) || installationId <= 0) throw new Error('GitHub App 安装 ID 无效')
    const privateKey = await readFile(keyPath, 'utf8')
    return createGitAdapter(
      config,
      { provider, authKind, instanceUrl },
      {
        githubApp: (selected) => createGitHubAppAdapter({ ...selected, appId, privateKey, installationId }),
      },
    )
  }
}
