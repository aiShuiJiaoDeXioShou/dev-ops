import { and, desc, eq, ne, sql } from 'drizzle-orm'
import type { Database } from '../../platform/database/client.ts'
import type { StorageProbeResult } from './adapters/local.adapter.ts'
import { storageBucket, storageBucketEvent } from './storage.tables.ts'

type TransactionDatabase = Parameters<Parameters<Database['transaction']>[0]>[0]
export type StorageExecutor = Database | TransactionDatabase

/** 储存桶配置行。 */
export type StorageBucketRow = typeof storageBucket.$inferSelect

/** 储存桶配置审计动作；取值受数据库 CHECK 约束。 */
export type StorageBucketEventAction =
  'bucket_created' | 'bucket_updated' | 'bucket_probed' | 'bucket_set_default' | 'bucket_removed'

/**
 * 按标识读取储存桶配置。
 * @param executor 数据库连接或事务。
 * @param bucketId 储存桶标识。
 * @returns 储存桶行；不存在时返回 undefined。
 * @remarks 附件记录固化 bucket_id，下载与清理必须按记录读取，不能回退到当前默认桶。
 */
export async function findBucketById(
  executor: StorageExecutor,
  bucketId: string,
): Promise<StorageBucketRow | undefined> {
  const [row] = await executor.select().from(storageBucket).where(eq(storageBucket.id, bucketId)).limit(1)
  return row
}

/**
 * 读取平台全部储存桶配置。
 * @param executor 数据库连接或事务。
 * @returns 稳定排序的桶列表：内置桶在最前，其次默认桶，最后按创建时间倒序。
 */
export async function findStorageBuckets(executor: StorageExecutor): Promise<StorageBucketRow[]> {
  return executor
    .select()
    .from(storageBucket)
    .orderBy(
      desc(storageBucket.is_builtin),
      desc(storageBucket.is_default),
      desc(storageBucket.created_at),
      desc(storageBucket.id),
    )
}

/** 新建储存桶配置的字段；密文列由服务层加密后传入。 */
export interface NewStorageBucket {
  id: string
  name: string
  kind: string
  isBuiltin: boolean
  isDefault: boolean
  status: string
  endpoint: string | null
  bucketName: string | null
  region: string | null
  pathPrefix: string | null
  accessKeyHint: string | null
  credentialCiphertext: string | null
  credentialIv: string | null
  credentialAuthTag: string | null
  credentialKeyVersion: number | null
  lastProbeResult: StorageProbeResult | null
  lastProbeMessage: string | null
  lastProbedAt: Date | null
  createdByUserId: string
}

/**
 * 插入储存桶配置。
 * @param executor 数据库连接或事务。
 * @param input 已经过业务校验与凭据加密的字段。
 * @returns 新行。
 */
export async function insertStorageBucket(
  executor: StorageExecutor,
  input: NewStorageBucket,
): Promise<StorageBucketRow> {
  const [row] = await executor
    .insert(storageBucket)
    .values({
      id: input.id,
      name: input.name,
      kind: input.kind,
      is_builtin: input.isBuiltin,
      is_default: input.isDefault,
      status: input.status,
      endpoint: input.endpoint,
      bucket_name: input.bucketName,
      region: input.region,
      path_prefix: input.pathPrefix,
      access_key_hint: input.accessKeyHint,
      credential_ciphertext: input.credentialCiphertext,
      credential_iv: input.credentialIv,
      credential_auth_tag: input.credentialAuthTag,
      credential_key_version: input.credentialKeyVersion,
      last_probe_result: input.lastProbeResult,
      last_probe_message: input.lastProbeMessage,
      last_probed_at: input.lastProbedAt,
      created_by_user_id: input.createdByUserId,
    })
    .returning()
  if (!row) throw new Error('储存桶写入未返回记录')
  return row
}

/** 储存桶配置可更新字段；undefined 表示保持原值。 */
export interface StorageBucketPatch {
  name?: string
  status?: string
  endpoint?: string | null
  bucketName?: string | null
  region?: string | null
  pathPrefix?: string | null
  accessKeyHint?: string | null
  credentialCiphertext?: string
  credentialIv?: string
  credentialAuthTag?: string
  credentialKeyVersion?: number
  isDefault?: boolean
}

/**
 * 按版本条件更新储存桶配置并递增版本号。
 * @param executor 数据库连接或事务。
 * @param bucketId 储存桶标识。
 * @param expectedVersion 客户端持有的乐观锁版本。
 * @param patch 需要更新的字段；未提供字段保持原值。
 * @returns 更新后的行；版本不匹配时返回 undefined。
 */
export async function updateStorageBucketByVersion(
  executor: StorageExecutor,
  bucketId: string,
  expectedVersion: number,
  patch: StorageBucketPatch,
): Promise<StorageBucketRow | undefined> {
  const [row] = await executor
    .update(storageBucket)
    .set({
      ...(patch.name === undefined ? {} : { name: patch.name }),
      ...(patch.status === undefined ? {} : { status: patch.status }),
      ...(patch.endpoint === undefined ? {} : { endpoint: patch.endpoint }),
      ...(patch.bucketName === undefined ? {} : { bucket_name: patch.bucketName }),
      ...(patch.region === undefined ? {} : { region: patch.region }),
      ...(patch.pathPrefix === undefined ? {} : { path_prefix: patch.pathPrefix }),
      ...(patch.accessKeyHint === undefined ? {} : { access_key_hint: patch.accessKeyHint }),
      ...(patch.credentialCiphertext === undefined ? {} : { credential_ciphertext: patch.credentialCiphertext }),
      ...(patch.credentialIv === undefined ? {} : { credential_iv: patch.credentialIv }),
      ...(patch.credentialAuthTag === undefined ? {} : { credential_auth_tag: patch.credentialAuthTag }),
      ...(patch.credentialKeyVersion === undefined ? {} : { credential_key_version: patch.credentialKeyVersion }),
      ...(patch.isDefault === undefined ? {} : { is_default: patch.isDefault }),
      version: sql`${storageBucket.version} + 1`,
      updated_at: new Date(),
    })
    .where(and(eq(storageBucket.id, bucketId), eq(storageBucket.version, expectedVersion)))
    .returning()
  return row
}

/**
 * 把当前默认桶取消默认。
 * @param executor 数据库连接或事务。
 * @param exceptBucketId 保留默认标记的目标桶；切换默认时避免先取消自己。
 * @returns 受影响行数。
 * @remarks 单默认桶由部分唯一索引兜底；因此切换默认必须先取消旧默认。
 */
export async function clearDefaultBucket(executor: StorageExecutor, exceptBucketId: string): Promise<void> {
  await executor
    .update(storageBucket)
    .set({ is_default: false, updated_at: new Date() })
    .where(and(eq(storageBucket.is_default, true), ne(storageBucket.id, exceptBucketId)))
}

/**
 * 持久化探测结论。
 * @param executor 数据库连接或事务。
 * @param bucketId 储存桶标识。
 * @param probe 结论、可读原因与探测时间。
 * @returns 更新后的行；桶已被删除时返回 undefined。
 * @remarks 探测只更新展示信息，不递增版本号；配置编辑的乐观锁语义不受测试连接影响。
 */
export async function updateStorageBucketProbe(
  executor: StorageExecutor,
  bucketId: string,
  probe: { result: StorageProbeResult; message: string; at: Date },
): Promise<StorageBucketRow | undefined> {
  const [row] = await executor
    .update(storageBucket)
    .set({
      last_probe_result: probe.result,
      last_probe_message: probe.message,
      last_probed_at: probe.at,
      updated_at: probe.at,
    })
    .where(eq(storageBucket.id, bucketId))
    .returning()
  return row
}

/**
 * 删除储存桶配置。
 * @param executor 数据库连接或事务。
 * @param bucketId 储存桶标识。
 * @returns 是否删除了记录；桶不存在时返回 false。
 * @remarks 内置桶与引用校验必须由服务层在调用前完成。
 */
export async function deleteStorageBucket(executor: StorageExecutor, bucketId: string): Promise<boolean> {
  const rows = await executor
    .delete(storageBucket)
    .where(eq(storageBucket.id, bucketId))
    .returning({ id: storageBucket.id })
  return rows.length > 0
}

/**
 * 追加储存桶配置审计事件。
 * @param executor 数据库连接或事务。
 * @param input 桶、动作、操作者与脱敏后的变更摘要。
 * @returns 无返回值；事件不随桶删除而删除。
 */
export async function appendStorageBucketEvent(
  executor: StorageExecutor,
  input: {
    id: string
    bucketId: string
    action: StorageBucketEventAction
    actorUserId: string
    changes: Record<string, unknown>
  },
): Promise<void> {
  await executor.insert(storageBucketEvent).values({
    id: input.id,
    bucket_id: input.bucketId,
    action: input.action,
    actor_user_id: input.actorUserId,
    changes: input.changes,
  })
}

/**
 * 判断数据库错误是否为唯一约束冲突。
 * @param error 未知异常。
 * @returns PostgreSQL 唯一冲突（23505）时返回 true。
 */
export function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  if ('code' in error && error.code === '23505') return true
  return 'cause' in error && isUniqueViolation(error.cause)
}
