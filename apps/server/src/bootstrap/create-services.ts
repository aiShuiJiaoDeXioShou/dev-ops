import type { AppConfig } from '../platform/config/env.ts'
import { createDatabase } from '../platform/database/client.ts'
import { createIdentityAuth } from '../modules/identity/identity.auth.ts'
import { createIdentityService } from '../modules/identity/identity.service.ts'
import { createTokenService } from '../modules/identity/identity.tokens.ts'
import { createProjectsService } from '../modules/projects/projects.service.ts'
import { createKnowledgeService } from '../modules/knowledge/knowledge.service.ts'
import { createRequirementsService } from '../modules/requirements/requirements.service.ts'
import { createBugsService } from '../modules/bugs/bugs.service.ts'
import { createCodeService } from '../modules/code/code.service.ts'
import { readFile } from 'node:fs/promises'
import type { GitAdapter } from '../adapters/git/git.types.ts'
import { createGitAdapter } from '../adapters/git/git.registry.ts'
import { createGitHubCliAdapter } from '../adapters/git/github-cli.adapter.ts'
import { createGitHubAppAdapter } from '../adapters/git/github.adapter.ts'
import { createGiteaAdapter } from '../adapters/git/gitea.adapter.ts'
import { findGitConnectionById } from '../modules/integrations/integrations.repository.ts'
import { createConfigurationService } from '../modules/configuration/configuration.service.ts'
import { createDeliveryService } from '../modules/delivery/delivery.service.ts'
import { createSecretCipher } from '../modules/configuration/configuration.crypto.ts'
import { createIntegrationsService, type GitAdapterFactory } from '../modules/integrations/integrations.service.ts'
import { createSmtpMailer } from '../adapters/mail/smtp-mailer.ts'
import type { MailSender } from '../adapters/mail/mail.types.ts'

/**
 * 组装进程级依赖：数据库连接、认证实例与后续业务模块。
 * @param config 已校验配置。
 * @param onDatabaseIdleError 空闲连接异常回调，由入口记录日志。
 * @returns 服务对象与关闭函数；模块只接收依赖，不直接创建全局连接。
 */
export function createServices(
  config: AppConfig,
  onDatabaseIdleError: (code: string | undefined) => void,
  options: {
    mailer?: MailSender
    gitAdapterResolver?: (connectionId: string) => Promise<GitAdapter>
    activeConnectionIds?: (teamId: string) => Promise<string[]>
    gitAdapterFactory?: (connection: Parameters<GitAdapterFactory>[0]) => Promise<GitAdapter>
  } = {},
) {
  const database = createDatabase(config, onDatabaseIdleError)
  const auth = createIdentityAuth(database.db, config)
  const mailer = options.mailer ?? createSmtpMailer(config)
  const identity = createIdentityService({ db: database.db, auth, config, mailer })
  const tokens = createTokenService({ db: database.db })
  const configuration = config.GIT_CREDENTIAL_ENCRYPTION_KEY
    ? createConfigurationService({ db: database.db, cipher: createSecretCipher(config.GIT_CREDENTIAL_ENCRYPTION_KEY) })
    : null
  type ConnectionRow = Parameters<GitAdapterFactory>[0]
  async function buildGitAdapter(connection: ConnectionRow): Promise<GitAdapter> {
    const input = {
      provider: connection.provider_key as 'github' | 'gitea',
      authKind: connection.auth_kind as 'github_cli' | 'github_app_installation' | 'gitea_token',
      instanceUrl: connection.instance_url,
    }
    if (connection.auth_kind === 'github_cli') {
      return createGitAdapter(config, input, { githubCli: (selected) => createGitHubCliAdapter(selected) })
    }
    if (connection.auth_kind === 'gitea_token') {
      if (!configuration || !connection.secret_id) throw new Error('Gitea 凭据未配置')
      const token = await configuration.decryptSecret(connection.team_id, connection.secret_id)
      return createGitAdapter(config, input, { gitea: (selected) => createGiteaAdapter({ ...selected, token }) })
    }
    if (!config.GITHUB_APP_ID || !config.GITHUB_APP_PRIVATE_KEY_PATH) throw new Error('GitHub App 凭据未配置')
    const installationId = Number(connection.external_identity)
    if (!Number.isSafeInteger(installationId) || installationId <= 0) throw new Error('GitHub App 安装 ID 无效')
    const privateKey = await readFile(config.GITHUB_APP_PRIVATE_KEY_PATH, 'utf8')
    return createGitAdapter(config, input, {
      githubApp: (selected) =>
        createGitHubAppAdapter({ ...selected, appId: config.GITHUB_APP_ID ?? '', privateKey, installationId }),
    })
  }
  const gitAdapterFactory = options.gitAdapterFactory ?? buildGitAdapter
  const integrations = createIntegrationsService({
    db: database.db,
    config,
    configuration,
    adapterFactory: gitAdapterFactory,
  })
  const code = createCodeService({
    db: database.db,
    resolveAdapter:
      options.gitAdapterResolver ??
      (async (connectionId) => {
        const connection = await findGitConnectionById(database.db, connectionId)
        if (!connection || connection.status !== 'active') throw new Error('Git 连接不可用')
        return gitAdapterFactory(connection)
      }),
    listActiveConnectionIds: options.activeConnectionIds ?? integrations.listActiveConnections,
  })
  const bugs = createBugsService({ db: database.db, codeReferences: code.listReferencesForTarget })
  const requirements = createRequirementsService({
    db: database.db,
    bugs: bugs.listLinkedBugs,
    codeReferences: code.listReferencesForTarget,
  })
  const delivery = createDeliveryService({ db: database.db })
  const projects = createProjectsService({
    db: database.db,
    counts: async (projectIds) => {
      const [openRequirements, openBugs] = await Promise.all([
        requirements.countOpenRequirements(projectIds),
        bugs.countOpenBugs(projectIds),
      ])
      return new Map(
        projectIds.map((id) => [
          id,
          {
            openRequirements: openRequirements.get(id) ?? 0,
            openBugs: openBugs.get(id) ?? 0,
          },
        ]),
      )
    },
  })

  const knowledge = createKnowledgeService({ db: database.db })

  return {
    database,
    auth,
    identity,
    tokens,
    knowledge,
    requirements,
    bugs,
    configuration,
    integrations,
    code,
    delivery,
    projects,
    async close() {
      await database.close()
    },
  }
}
