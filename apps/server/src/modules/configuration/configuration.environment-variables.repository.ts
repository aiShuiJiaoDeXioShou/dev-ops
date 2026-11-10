import { and, eq, inArray } from 'drizzle-orm'
import type { Database } from '../../platform/database/client.ts'
import { credential, credentialProjectGrant, projectEnvVar } from './configuration.tables.ts'

type TransactionDatabase = Parameters<Parameters<Database['transaction']>[0]>[0]
export type EnvVarExecutor = Database | TransactionDatabase

/** 环境变量完整行投影；调用方不得把 value_text 直接作为密钥引用响应返回。 */
const envVarColumns = {
  id: projectEnvVar.id,
  team_id: projectEnvVar.team_id,
  project_id: projectEnvVar.project_id,
  environment: projectEnvVar.environment,
  name: projectEnvVar.name,
  kind: projectEnvVar.kind,
  value_text: projectEnvVar.value_text,
  credential_id: projectEnvVar.credential_id,
  status: projectEnvVar.status,
  version: projectEnvVar.version,
  created_by_user_id: projectEnvVar.created_by_user_id,
  created_at: projectEnvVar.created_at,
  updated_at: projectEnvVar.updated_at,
}

/** 按标识查找环境变量行。 */
export async function findEnvVarById(executor: EnvVarExecutor, variableId: string) {
  const [row] = await executor
    .select(envVarColumns)
    .from(projectEnvVar)
    .where(eq(projectEnvVar.id, variableId))
    .limit(1)
  return row
}

/** 按项目、环境与名称查找变量；唯一约束仍负责并发一致性。 */
export async function findEnvVarByProjectEnvName(db: Database, projectId: string, environment: string, name: string) {
  const [row] = await db
    .select({ id: projectEnvVar.id })
    .from(projectEnvVar)
    .where(
      and(
        eq(projectEnvVar.project_id, projectId),
        eq(projectEnvVar.environment, environment),
        eq(projectEnvVar.name, name),
      ),
    )
    .limit(1)
  return row
}

/** 查询项目指定环境的全部变量，按名称稳定排序。 */
export async function listEnvVars(db: Database, projectId: string, environment: string) {
  return db
    .select(envVarColumns)
    .from(projectEnvVar)
    .where(and(eq(projectEnvVar.project_id, projectId), eq(projectEnvVar.environment, environment)))
    .orderBy(projectEnvVar.name)
}

/** 插入环境变量；凭据引用只保存 credential_id，不复制密钥。 */
export async function insertEnvVar(
  executor: EnvVarExecutor,
  input: {
    id: string
    teamId: string
    projectId: string
    environment: string
    name: string
    kind: string
    valueText: string | null
    credentialId: string | null
    createdByUserId: string
  },
) {
  const [row] = await executor
    .insert(projectEnvVar)
    .values({
      id: input.id,
      team_id: input.teamId,
      project_id: input.projectId,
      environment: input.environment,
      name: input.name,
      kind: input.kind,
      value_text: input.valueText,
      credential_id: input.credentialId,
      created_by_user_id: input.createdByUserId,
    })
    .returning()
  if (!row) throw new Error('环境变量写入失败')
  return row
}

/**
 * 乐观锁更新环境变量，仅更新传入字段。
 * @param tx 事务连接。
 * @param variableId 变量标识。
 * @param expectedVersion 调用方持有的当前版本。
 * @param values 待更新字段：名称、普通值、凭据引用或状态。
 * @returns 更新行；版本不匹配时返回 undefined，由服务层报告冲突。
 */
export async function updateEnvVar(
  tx: TransactionDatabase,
  variableId: string,
  expectedVersion: number,
  values: { name?: string; valueText?: string; credentialId?: string; status?: string },
) {
  const [row] = await tx
    .update(projectEnvVar)
    .set({
      ...(values.name === undefined ? {} : { name: values.name }),
      ...(values.valueText === undefined ? {} : { value_text: values.valueText }),
      ...(values.credentialId === undefined ? {} : { credential_id: values.credentialId }),
      ...(values.status === undefined ? {} : { status: values.status }),
      version: expectedVersion + 1,
      updated_at: new Date(),
    })
    .where(and(eq(projectEnvVar.id, variableId), eq(projectEnvVar.version, expectedVersion)))
    .returning()
  return row
}

/** 删除环境变量并返回被删行；变量不存在时返回 undefined。 */
export async function deleteEnvVar(tx: TransactionDatabase, variableId: string) {
  const [row] = await tx.delete(projectEnvVar).where(eq(projectEnvVar.id, variableId)).returning()
  return row
}

/** 批量加载环境变量引用的凭据元数据，避免列表接口 N+1 查询。 */
export async function findCredentialsByIds(db: Database, credentialIds: string[]) {
  if (credentialIds.length === 0) return []
  return db
    .select({
      id: credential.id,
      team_id: credential.team_id,
      name: credential.name,
      status: credential.status,
      current_version: credential.current_version,
      expires_at: credential.expires_at,
    })
    .from(credential)
    .where(inArray(credential.id, credentialIds))
}

/** 批量加载项目对各凭据的授权行（含已撤销），用于计算引用有效状态。 */
export async function findGrantsForProject(db: Database, projectId: string, credentialIds: string[]) {
  if (credentialIds.length === 0) return []
  return db
    .select({
      credential_id: credentialProjectGrant.credential_id,
      project_id: credentialProjectGrant.project_id,
      expires_at: credentialProjectGrant.expires_at,
      revoked_at: credentialProjectGrant.revoked_at,
    })
    .from(credentialProjectGrant)
    .where(
      and(
        eq(credentialProjectGrant.project_id, projectId),
        inArray(credentialProjectGrant.credential_id, credentialIds),
      ),
    )
}

/** 凭据撤销后把引用它的全部变量标记为失效；跨项目统一处理。 */
export async function markEnvVarsInvalidForCredential(executor: EnvVarExecutor, credentialId: string) {
  await executor
    .update(projectEnvVar)
    .set({ status: 'invalid', updated_at: new Date() })
    .where(and(eq(projectEnvVar.credential_id, credentialId), eq(projectEnvVar.status, 'active')))
}

/** 项目授权撤销后把该项目引用该凭据的变量标记为失效。 */
export async function markEnvVarsInvalidForCredentialInProject(
  executor: EnvVarExecutor,
  credentialId: string,
  projectId: string,
) {
  await executor
    .update(projectEnvVar)
    .set({ status: 'invalid', updated_at: new Date() })
    .where(
      and(
        eq(projectEnvVar.credential_id, credentialId),
        eq(projectEnvVar.project_id, projectId),
        eq(projectEnvVar.status, 'active'),
      ),
    )
}

/** 授权恢复后把该项目引用该凭据的失效变量恢复为可用。 */
export async function restoreEnvVarsForCredentialInProject(
  executor: EnvVarExecutor,
  credentialId: string,
  projectId: string,
) {
  await executor
    .update(projectEnvVar)
    .set({ status: 'active', updated_at: new Date() })
    .where(
      and(
        eq(projectEnvVar.credential_id, credentialId),
        eq(projectEnvVar.project_id, projectId),
        eq(projectEnvVar.status, 'invalid'),
      ),
    )
}
