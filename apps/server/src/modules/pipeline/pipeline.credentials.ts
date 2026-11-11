import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { createAppAuth } from '@octokit/auth-app'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import type { RunPlanGit } from '@dev-ops/pipeline-protocol'
import type { AppConfig } from '../../platform/config/env.ts'
import type { Database } from '../../platform/database/client.ts'
import { ERROR_CODES } from '../../platform/http/error-codes.ts'
import type { SecretCipher } from '../configuration/configuration.crypto.ts'
import { findSecretForDecrypt } from '../configuration/configuration.repository.ts'
import { insertCredentialUsage } from '../configuration/configuration.credentials.repository.ts'
import {
  credential,
  credentialProjectGrant,
  credentialVersion,
  projectEnvVar,
} from '../configuration/configuration.tables.ts'
import { findGitConnectionById } from '../integrations/integrations.repository.ts'

const execFileAsync = promisify(execFile)
const GH_TOKEN_TIMEOUT_MS = 5_000

/** Git 短期凭据签发失败；不包含底层令牌或错误详情，避免凭据进入日志。 */
export class PipelineCredentialError extends Error {
  readonly code = ERROR_CODES.PIPELINE_GIT_CREDENTIAL_ERROR

  constructor(message: string) {
    super(message)
    this.name = 'PipelineCredentialError'
  }
}

/** 运行时密钥引用无法解析（缺失、撤销、过期或未授权项目）。 */
export class PipelineSecretError extends Error {
  readonly code = ERROR_CODES.PIPELINE_SECRET_UNAVAILABLE

  constructor(message: string) {
    super(message)
    this.name = 'PipelineSecretError'
  }
}

/** 凭据签发所需的仓库信息；来自 code 模块的仓库快照，只使用标识与远端地址。 */
export interface PipelineCredentialRepository {
  teamId: string
  connectionId: string
  webUrl: string
  commitSha: string
}

/** 流水线运行所需的外部凭据提供者；由 bootstrap 注入，便于测试替换。 */
export interface PipelineCredentialProvider {
  issueGitCredential(repository: PipelineCredentialRepository): Promise<RunPlanGit>
  resolveSecrets(input: {
    teamId: string
    projectId: string
    environment: 'development' | 'test' | 'production'
    names: string[]
  }): Promise<Record<string, string>>
}

export interface PipelineCredentialProviderDeps {
  db: Database
  config: AppConfig
  cipher: SecretCipher | null
}

/** 把仓库网页地址归一化为 HTTPS clone 地址；拒绝非 HTTP(S) 来源。 */
function toRemoteUrl(webUrl: string): string {
  let url: URL
  try {
    url = new URL(webUrl)
  } catch {
    throw new PipelineCredentialError('仓库 HTTPS 地址不合法，无法签发 Git 凭据')
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new PipelineCredentialError('仓库地址只支持不含凭据的 HTTP(S)')
  }
  const path = url.pathname.replace(/\/+$/, '')
  if (path.length === 0) throw new PipelineCredentialError('仓库地址缺少路径')
  return `${url.origin}${path.endsWith('.git') ? path : `${path}.git`}`
}

/** 通过本机 GitHub CLI 读取登录令牌；仅 stg/开发环境使用 cli 模式。 */
async function readGitHubCliToken(): Promise<string> {
  try {
    const { stdout } = await execFileAsync('gh', ['auth', 'token'], { timeout: GH_TOKEN_TIMEOUT_MS })
    const token = stdout.trim()
    if (token.length === 0) throw new PipelineCredentialError('GitHub CLI 未返回有效令牌')
    return token
  } catch (error) {
    if (error instanceof PipelineCredentialError) throw error
    throw new PipelineCredentialError('GitHub CLI 令牌不可用，无法签发 Git 凭据')
  }
}

/**
 * 创建流水线凭据提供者：签发短期 Git 凭据并解析运行时 secrets 引用。
 * @param deps 数据库、应用配置与可选的团队凭据解密器。
 * @returns 供租约生成使用的 Git 凭据与密钥解析能力。
 * @remarks 返回值只进入 Agent 租约响应，不写入运行记录、日志或活动；明文在内存中短时存在。
 * secrets 引用按运行的目标环境解析，环境之间不自动继承。
 */
export function createPipelineCredentialProvider(deps: PipelineCredentialProviderDeps): PipelineCredentialProvider {
  const { db, config, cipher } = deps

  async function issueGitCredential(repository: PipelineCredentialRepository): Promise<RunPlanGit> {
    const connection = await findGitConnectionById(db, repository.connectionId)
    if (!connection || connection.team_id !== repository.teamId || connection.status !== 'active') {
      throw new PipelineCredentialError('Git 连接不可用，无法签发凭据')
    }
    const remoteUrl = toRemoteUrl(repository.webUrl)
    const leaseExpiresAt = new Date(Date.now() + config.PIPELINE_LEASE_TTL_SECONDS * 1000)
    if (connection.auth_kind === 'gitea_token') {
      if (!cipher || !connection.secret_id) throw new PipelineCredentialError('Gitea 凭据未配置')
      const secret = await findSecretForDecrypt(db, repository.teamId, connection.secret_id)
      if (!secret) throw new PipelineCredentialError('Gitea 凭据不可用')
      const password = cipher.decrypt({
        ciphertext: secret.ciphertext,
        iv: secret.iv,
        authTag: secret.auth_tag,
        keyVersion: secret.key_version,
      })
      return {
        remoteUrl,
        username: 'oauth2',
        password,
        expiresAt: leaseExpiresAt.toISOString(),
        commitSha: repository.commitSha,
      }
    }
    if (connection.auth_kind === 'github_app_installation') {
      if (!config.GITHUB_APP_ID || !config.GITHUB_APP_PRIVATE_KEY_PATH) {
        throw new PipelineCredentialError('GitHub App 凭据未配置')
      }
      const installationId = Number(connection.external_identity)
      if (!Number.isSafeInteger(installationId) || installationId <= 0) {
        throw new PipelineCredentialError('GitHub App 安装标识不合法')
      }
      const privateKey = await readFile(config.GITHUB_APP_PRIVATE_KEY_PATH, 'utf8')
      const auth = createAppAuth({ appId: config.GITHUB_APP_ID, privateKey, installationId })
      const result = await auth({ type: 'installation' })
      return {
        remoteUrl,
        username: 'x-access-token',
        password: result.token,
        expiresAt: result.expiresAt,
        commitSha: repository.commitSha,
      }
    }
    // cli 模式没有平台侧 App 身份，复用本机 gh 登录令牌；凭据只在租约有效期内下发。
    const token = await readGitHubCliToken()
    return {
      remoteUrl,
      username: 'x-access-token',
      password: token,
      expiresAt: leaseExpiresAt.toISOString(),
      commitSha: repository.commitSha,
    }
  }

  async function resolveSecrets(input: {
    teamId: string
    projectId: string
    environment: 'development' | 'test' | 'production'
    names: string[]
  }): Promise<Record<string, string>> {
    if (!['development', 'test', 'production'].includes(input.environment)) {
      throw new PipelineSecretError('运行目标环境不合法')
    }
    const names = [...new Set(input.names)].filter(Boolean)
    if (names.length === 0) return {}
    const rows = await db
      .select({
        name: projectEnvVar.name,
        kind: projectEnvVar.kind,
        value_text: projectEnvVar.value_text,
        credential_id: projectEnvVar.credential_id,
        status: projectEnvVar.status,
      })
      .from(projectEnvVar)
      .where(
        and(
          eq(projectEnvVar.project_id, input.projectId),
          eq(projectEnvVar.team_id, input.teamId),
          eq(projectEnvVar.environment, input.environment),
          inArray(projectEnvVar.name, names),
        ),
      )
    const resolved: Record<string, string> = {}
    const credentialIds: string[] = []
    for (const row of rows) {
      if (row.status !== 'active') continue
      if (row.kind === 'plain' && row.value_text !== null) {
        resolved[row.name] = row.value_text
      } else if (row.kind === 'credential_ref' && row.credential_id !== null) {
        credentialIds.push(row.credential_id)
      }
    }
    if (credentialIds.length > 0) {
      if (!cipher) throw new PipelineSecretError('运行时密钥引用需要配置 GIT_CREDENTIAL_ENCRYPTION_KEY')
      const credentialRows = await db
        .select({
          id: credential.id,
          current_version: credential.current_version,
          status: credential.status,
          expires_at: credential.expires_at,
        })
        .from(credential)
        .where(and(inArray(credential.id, credentialIds), eq(credential.team_id, input.teamId)))
      const grants = await db
        .select({
          credential_id: credentialProjectGrant.credential_id,
          expires_at: credentialProjectGrant.expires_at,
        })
        .from(credentialProjectGrant)
        .where(
          and(
            inArray(credentialProjectGrant.credential_id, credentialIds),
            eq(credentialProjectGrant.project_id, input.projectId),
            isNull(credentialProjectGrant.revoked_at),
          ),
        )
      const now = Date.now()
      const grantIds = new Set(
        grants
          .filter((grant) => grant.expires_at === null || grant.expires_at.getTime() > now)
          .map((grant) => grant.credential_id),
      )
      for (const row of rows) {
        if (row.kind !== 'credential_ref' || row.credential_id === null) continue
        const record = credentialRows.find((item) => item.id === row.credential_id)
        if (!record || record.status !== 'active') continue
        if (record.expires_at !== null && record.expires_at.getTime() <= now) continue
        if (!grantIds.has(record.id)) continue
        const [version] = await db
          .select({
            ciphertext: credentialVersion.ciphertext,
            iv: credentialVersion.iv,
            auth_tag: credentialVersion.auth_tag,
            key_version: credentialVersion.key_version,
          })
          .from(credentialVersion)
          .where(
            and(eq(credentialVersion.credential_id, record.id), eq(credentialVersion.version, record.current_version)),
          )
          .limit(1)
        if (!version) continue
        resolved[row.name] = cipher.decrypt({
          ciphertext: version.ciphertext,
          iv: version.iv,
          authTag: version.auth_tag,
          keyVersion: version.key_version,
        })
        // 每次注入记录使用事实，只保存凭据标识、版本与目标环境，不保存值。
        await insertCredentialUsage(db, {
          id: randomUUID(),
          teamId: input.teamId,
          credentialId: record.id,
          credentialVersion: record.current_version,
          projectId: input.projectId,
          environment: input.environment,
          action: 'use',
          actorUserId: null,
          result: 'success',
          errorCode: null,
        })
      }
    }
    const missing = names.filter((name) => resolved[name] === undefined)
    if (missing.length > 0) {
      throw new PipelineSecretError(`运行时密钥不可用：${missing.join(', ')}`)
    }
    return resolved
  }

  return { issueGitCredential, resolveSecrets }
}
