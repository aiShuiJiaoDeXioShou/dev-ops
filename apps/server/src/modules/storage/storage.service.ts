import { eq } from 'drizzle-orm'
import type { Database } from '../../platform/database/client.ts'
import { ApiError } from '../../platform/http/errors.ts'
import { ERROR_CODES } from '../../platform/http/error-codes.ts'
import { BUILTIN_LOCAL_BUCKET_ID, SYSTEM_ACTOR_USER_ID, storageBucket } from './storage.tables.ts'
import { createLocalStorageAdapter } from './adapters/local.adapter.ts'
import type { StorageAdapter } from './adapters/local.adapter.ts'
import { createS3StorageAdapter } from './adapters/s3.adapter.ts'
import { decryptBucketCredentials } from './storage.crypto.ts'
import { findBucketById, type StorageBucketRow } from './storage.repository.ts'
import type { SecretCipher } from '../configuration/configuration.crypto.ts'

export type { StorageBucketRow }

/** 储存服务配置。 */
export interface StorageServiceConfig {
  localDir: string
  probeTimeoutMs: number
}

/** 储存服务依赖。 */
export interface StorageServiceOptions {
  db: Database
  cipher: SecretCipher | null
  config: StorageServiceConfig
}

/** 储存服务公开能力。 */
export interface StorageService {
  /** 校验内置桶存在与不变量；缺失时补建，被误改时抛错阻止启动。 */
  ensureBuiltinBucket(): Promise<'ok' | 'created'>
  /** 解析当前默认桶；无默认时回退内置本地桶。 */
  resolveDefaultBucket(): Promise<StorageBucketRow>
  /** 按桶配置构造适配器。 */
  adapterFor(bucket: StorageBucketRow): StorageAdapter
  /** 按记录固化的桶标识构造适配器；桶缺失或停用时返回附件存储不可用业务错误。 */
  adapterForBucketId(bucketId: string): Promise<StorageAdapter>
  /** 生成附件对象键：不包含用户文件名。 */
  attachmentStorageKey(input: { teamId: string; projectId: string; attachmentId: string }): string
}

/**
 * 创建储存服务。
 * @param options 数据库、加解密器与本地目录配置。
 * @returns 内置桶校验、默认桶解析与适配器构造能力。
 */
export function createStorageService(options: StorageServiceOptions): StorageService {
  const { db, config } = options

  function adapterFor(bucket: StorageBucketRow): StorageAdapter {
    if (bucket.kind === 'local') {
      if (!bucket.is_builtin) throw new Error('本地储存桶只能由平台内置创建')
      return createLocalStorageAdapter({ rootDir: config.localDir })
    }
    if (bucket.kind !== 's3') throw new Error('储存桶类型不合法')
    if (!bucket.endpoint || !bucket.bucket_name || !bucket.region) {
      throw new Error('储存桶缺少接入地址、桶名或区域配置')
    }
    return createS3StorageAdapter({
      endpoint: bucket.endpoint,
      region: bucket.region,
      bucketName: bucket.bucket_name,
      pathPrefix: bucket.path_prefix,
      credentials: bucketCredentials(options.cipher, bucket),
      probeTimeoutMs: config.probeTimeoutMs,
    })
  }

  /**
   * 按附件记录固化的桶标识构造适配器。
   * @param bucketId 上传时记录的桶标识。
   * @returns 对应桶的适配器。
   * @throws 桶记录缺失、已停用或适配器不可用时抛出 ATTACHMENT_STORAGE_UNAVAILABLE。
   */
  async function adapterForBucketId(bucketId: string): Promise<StorageAdapter> {
    const bucket = await findBucketById(db, bucketId)
    if (!bucket) {
      throw new ApiError(ERROR_CODES.ATTACHMENT_STORAGE_UNAVAILABLE, '附件储存桶配置缺失，请联系平台管理员')
    }
    if (bucket.status !== 'enabled') {
      throw new ApiError(ERROR_CODES.ATTACHMENT_STORAGE_UNAVAILABLE, '附件储存桶已停用，请联系平台管理员')
    }
    try {
      return adapterFor(bucket)
    } catch (error) {
      throw new ApiError(
        ERROR_CODES.ATTACHMENT_STORAGE_UNAVAILABLE,
        error instanceof Error ? error.message : '附件储存桶不可用',
      )
    }
  }

  async function ensureBuiltinBucket(): Promise<'ok' | 'created'> {
    const [existing] = await db
      .select()
      .from(storageBucket)
      .where(eq(storageBucket.id, BUILTIN_LOCAL_BUCKET_ID))
      .limit(1)

    if (!existing) {
      const [hasDefault] = await db
        .select({ id: storageBucket.id })
        .from(storageBucket)
        .where(eq(storageBucket.is_default, true))
        .limit(1)
      await db.insert(storageBucket).values({
        id: BUILTIN_LOCAL_BUCKET_ID,
        name: '本地储存',
        kind: 'local',
        is_builtin: true,
        is_default: !hasDefault,
        status: 'enabled',
        created_by_user_id: SYSTEM_ACTOR_USER_ID,
      })
      return 'created'
    }

    if (existing.kind !== 'local' || !existing.is_builtin) {
      throw new Error('内置本地储存桶配置被修改，请修正 storage_bucket 后再启动')
    }
    if (existing.status !== 'enabled') {
      throw new Error('内置本地储存桶不可停用，请修正 storage_bucket 后再启动')
    }
    return 'ok'
  }

  async function resolveDefaultBucket(): Promise<StorageBucketRow> {
    const [preferred] = await db.select().from(storageBucket).where(eq(storageBucket.is_default, true)).limit(1)
    if (preferred && preferred.status === 'enabled') return preferred
    const [builtin] = await db
      .select()
      .from(storageBucket)
      .where(eq(storageBucket.id, BUILTIN_LOCAL_BUCKET_ID))
      .limit(1)
    if (!builtin) throw new Error('内置本地储存桶不存在，请执行数据库迁移')
    return builtin
  }

  return {
    ensureBuiltinBucket,
    resolveDefaultBucket,
    adapterFor,
    adapterForBucketId,
    attachmentStorageKey: ({ teamId, projectId, attachmentId }) => `attachments/${teamId}/${projectId}/${attachmentId}`,
  }
}

/** 解密桶凭据；S3 适配器使用。 */
export function bucketCredentials(cipher: SecretCipher | null, bucket: StorageBucketRow) {
  if (!bucket.credential_ciphertext || !bucket.credential_iv || !bucket.credential_auth_tag) {
    throw new Error('储存桶缺少凭据密文')
  }
  return decryptBucketCredentials(cipher, {
    ciphertext: bucket.credential_ciphertext,
    iv: bucket.credential_iv,
    authTag: bucket.credential_auth_tag,
    keyVersion: bucket.credential_key_version ?? 1,
  })
}
