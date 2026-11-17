import type { AppConfig } from '../platform/config/env.ts'
import { createDatabase } from '../platform/database/client.ts'
import { createIdentityAuth } from '../modules/identity/identity.auth.ts'
import { createIdentityService } from '../modules/identity/identity.service.ts'
import { createTokenService } from '../modules/identity/identity.tokens.ts'
import { createProjectLifecycleService } from '../modules/projects/projects.lifecycle.service.ts'
import { createProjectsService } from '../modules/projects/projects.service.ts'
import { createKnowledgeService } from '../modules/knowledge/knowledge.service.ts'
import { createRequirementsService } from '../modules/requirements/requirements.service.ts'
import { createBugsService } from '../modules/bugs/bugs.service.ts'
import { createCodeService } from '../modules/code/code.service.ts'
import type { GitAdapter } from '../adapters/git/git.types.ts'
import {
  exchangeGitHubUserTokens,
  getGitHubRepositoryPermissions,
  getGitHubUser,
  verifyGitHubInstallation,
} from '../adapters/git/github-authorization.ts'
import { findGitConnectionById } from '../modules/integrations/integrations.repository.ts'
import { createConfigurationService } from '../modules/configuration/configuration.service.ts'
import { verifySessionPassword } from '../modules/identity/identity.password.ts'
import { createDeliveryService } from '../modules/delivery/delivery.service.ts'
import { createPipelineService } from '../modules/pipeline/pipeline.service.ts'
import { createCodeChangeService, reconcileCodeChangeFromRun } from '../modules/tools/tools.code-change.service.ts'
import { createRemoteWriteService } from '../modules/tools/tools.remote-write.service.ts'
import { createPipelineNodesService } from '../modules/pipeline/pipeline.nodes.service.ts'
import { createPipelineAgentService } from '../modules/pipeline/pipeline.agent.service.ts'
import {
  createPipelineCredentialProvider,
  type PipelineCredentialProvider,
} from '../modules/pipeline/pipeline.credentials.ts'
import { createPipelineStorage } from '../modules/pipeline/pipeline.storage.ts'
import { createProjectDashboardService } from '../modules/projects/projects.dashboard.service.ts'
import { createStorageService } from '../modules/storage/storage.service.ts'
import { createStorageManagementService } from '../modules/storage/storage.management.service.ts'
import { createAttachmentsService } from '../modules/attachments/attachments.service.ts'
import { createAttachmentBinding } from '../modules/attachments/attachments.binding.ts'
import { createSecretCipher } from '../modules/configuration/configuration.crypto.ts'
import { createIntegrationsService, type GitAdapterFactory } from '../modules/integrations/integrations.service.ts'
import { createGitHubAccountService } from '../modules/integrations/integrations.github-account.service.ts'
import { createSmtpMailer } from '../adapters/mail/smtp-mailer.ts'
import type { MailSender } from '../adapters/mail/mail.types.ts'
import { createGitConnectionAdapterFactory } from './create-git-connection-adapter.ts'

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
    githubUserFetcher?: typeof fetch
    /** 测试或部署可替换 Git 凭据来源；默认由 integrations/configuration 与 CLI/App 凭据签发。 */
    pipelineCredentials?: PipelineCredentialProvider
    /** 结构化告警日志；附件对象清理失败等无法转化为业务结果的问题写入此处。 */
    log?: (message: string, context?: Record<string, unknown>) => void
  } = {},
) {
  const database = createDatabase(config, onDatabaseIdleError)
  const mailer = options.mailer ?? createSmtpMailer(config)
  const auth = createIdentityAuth(database.db, config, mailer)
  const identity = createIdentityService({ db: database.db, auth, config, mailer })
  const tokens = createTokenService({ db: database.db })
  const secretCipher = config.GIT_CREDENTIAL_ENCRYPTION_KEY
    ? createSecretCipher(config.GIT_CREDENTIAL_ENCRYPTION_KEY)
    : null
  const configuration = secretCipher
    ? createConfigurationService({
        db: database.db,
        cipher: secretCipher,
        verifyPassword: (headers, password) => verifySessionPassword(auth, headers, password),
      })
    : null
  const gitAdapterFactory =
    options.gitAdapterFactory ??
    createGitConnectionAdapterFactory({
      config,
      db: database.db,
      cipher: secretCipher,
    })
  const integrations = createIntegrationsService({
    db: database.db,
    config,
    configuration,
    adapterFactory: gitAdapterFactory,
    verifyGitHubInstallation,
  })
  const githubAccount = createGitHubAccountService({
    db: database.db,
    config,
    cipher: secretCipher,
    github: {
      exchangeTokens: (input) => exchangeGitHubUserTokens({ ...input, fetcher: options.githubUserFetcher }),
      getUser: (accessToken) => getGitHubUser(accessToken, options.githubUserFetcher),
      getRepositoryPermissions: (input) =>
        getGitHubRepositoryPermissions({ ...input, fetcher: options.githubUserFetcher }),
    },
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
    authorizeGitHubRepository: githubAccount.authorizeRepository,
  })
  const projectDashboard = createProjectDashboardService({ db: database.db })
  // 附件数量与保留期策略先于业务服务装配，供需求与缺陷在各自事务内绑定/解绑。
  const attachmentPolicy = {
    maxFileBytes: config.ATTACHMENT_MAX_BYTES,
    maxFilesPerSubmit: config.ATTACHMENT_MAX_PER_SUBMIT,
    maxFilesPerRecord: config.ATTACHMENT_MAX_PER_RECORD,
    tempRetentionHours: config.ATTACHMENT_TEMP_TTL_HOURS,
  }
  const attachmentBinding = createAttachmentBinding({ policy: attachmentPolicy })
  const bugs = createBugsService({
    db: database.db,
    codeReferences: code.listReferencesForTarget,
    attachmentBinding,
  })
  const requirements = createRequirementsService({
    db: database.db,
    bugs: bugs.listLinkedBugs,
    codeReferences: code.listReferencesForTarget,
    attachmentBinding,
  })
  const delivery = createDeliveryService({ db: database.db })
  const storage = createStorageService({
    db: database.db,
    cipher: secretCipher,
    config: { localDir: config.ATTACHMENT_STORAGE_DIR, probeTimeoutMs: config.STORAGE_PROBE_TIMEOUT_MS },
  })
  const storageManagement = createStorageManagementService({
    db: database.db,
    cipher: secretCipher,
    storage,
    probeTimeoutMs: config.STORAGE_PROBE_TIMEOUT_MS,
  })
  const attachments = createAttachmentsService({
    db: database.db,
    storage,
    policy: attachmentPolicy,
    ...(options.log ? { log: options.log } : {}),
  })
  const pipelineStorage = createPipelineStorage({
    rootDir: config.PIPELINE_STORAGE_DIR,
    maxLogChunkBytes: config.PIPELINE_LOG_CHUNK_MAX_BYTES,
    maxArtifactBytes: config.PIPELINE_ARTIFACT_MAX_BYTES,
  })
  const pipelineCredentials =
    options.pipelineCredentials ??
    createPipelineCredentialProvider({
      db: database.db,
      config,
      cipher: secretCipher,
    })
  const pipelineNodes = createPipelineNodesService({
    db: database.db,
    config: { leaseTtlSeconds: config.PIPELINE_LEASE_TTL_SECONDS },
  })
  const pipelineAgent = createPipelineAgentService({
    db: database.db,
    onRunFinalized: async (runId) => {
      await reconcileCodeChangeFromRun(database.db, runId)
    },
    config: {
      leaseTtlSeconds: config.PIPELINE_LEASE_TTL_SECONDS,
      maxLogChunkBytes: config.PIPELINE_LOG_CHUNK_MAX_BYTES,
      maxArtifactBytes: config.PIPELINE_ARTIFACT_MAX_BYTES,
    },
    storage: pipelineStorage,
    credentials: pipelineCredentials,
  })
  const pipeline = createPipelineService({
    db: database.db,
    code,
    storage: pipelineStorage,
    credentials: pipelineCredentials,
    config: {
      runTimeoutSeconds: config.PIPELINE_RUN_TIMEOUT_SECONDS,
      workflowMaxBytes: config.PIPELINE_WORKFLOW_MAX_BYTES,
      codeChangeTimeoutSeconds: config.CODE_CHANGE_TIMEOUT_SECONDS,
    },
  })
  const codeChanges = createCodeChangeService({
    db: database.db,
    pipeline,
    code,
    maxPatchBytes: config.CODE_CHANGE_PATCH_MAX_BYTES,
    diffResponseMaxBytes: config.CODE_CHANGE_DIFF_RESPONSE_MAX_BYTES,
  })
  const remoteWrite = createRemoteWriteService({ db: database.db, code })
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
    githubAccount,
    code,
    delivery,
    codeChanges,
    remoteWrite,
    pipeline,
    pipelineNodes,
    storage,
    storageManagement,
    attachments,
    attachmentBinding,
    pipelineAgent,
    projectDashboard,
    projects,
    projectLifecycle: createProjectLifecycleService(database.db, (headers, password) =>
      verifySessionPassword(auth, headers, password),
    ),
    async close() {
      await database.close()
    },
  }
}
