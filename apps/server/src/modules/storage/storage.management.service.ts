import { randomUUID } from 'node:crypto'
import { ApiError } from '../../platform/http/errors.ts'
import { ERROR_CODES } from '../../platform/http/error-codes.ts'
import { requirePlatformAdmin, type SessionUser } from '../identity/identity.session.ts'
import { countAttachmentsByBucket } from '../attachments/attachments.repository.ts'
import { createS3StorageAdapter } from './adapters/s3.adapter.ts'
import type { StorageBucketRow } from './storage.repository.ts'
import {
  appendStorageBucketEvent,
  clearDefaultBucket,
  deleteStorageBucket,
  findBucketById,
  findStorageBuckets,
  insertStorageBucket,
  isUniqueViolation,
  updateStorageBucketByVersion,
  updateStorageBucketProbe,
} from './storage.repository.ts'
import type {
  CreateStorageBucketInput,
  StorageManagementService,
  StorageManagementServiceOptions,
  StorageProbeView,
  UpdateStorageBucketInput,
} from './storage.types.ts'
import { normalizeCreateInput, prepareBucketUpdate, translateUniqueViolation } from './storage.validation.ts'
import { toStorageBucketView, type StorageBucketView } from './storage.view.ts'

export type {
  CreateStorageBucketInput,
  StorageManagementService,
  StorageManagementServiceOptions,
  StorageProbeView,
  UpdateStorageBucketInput,
} from './storage.types.ts'

/**
 * 创建储存桶管理服务。
 * @param options 数据库、敏感值加密器、储存服务与探测超时。
 * @returns 列表、创建、更新、测试、设默认与删除能力；每个用例先校验平台管理员身份。
 */
export function createStorageManagementService(options: StorageManagementServiceOptions): StorageManagementService {
  const { db, cipher, storage, probeTimeoutMs } = options

  async function requireBucket(bucketId: string): Promise<StorageBucketRow> {
    const bucket = await findBucketById(db, bucketId)
    if (!bucket) throw new ApiError(ERROR_CODES.STORAGE_BUCKET_NOT_FOUND, '储存桶不存在或已被删除')
    return bucket
  }

  async function listBuckets(actor: SessionUser): Promise<StorageBucketView[]> {
    await requirePlatformAdmin(db, actor.id)
    return (await findStorageBuckets(db)).map(toStorageBucketView)
  }

  async function createBucket(actor: SessionUser, input: CreateStorageBucketInput): Promise<StorageBucketView> {
    await requirePlatformAdmin(db, actor.id)
    if (!cipher) {
      throw new ApiError(ERROR_CODES.STORAGE_BUCKET_NOT_WRITABLE, '未配置敏感值加密密钥，无法保存储存桶凭据')
    }
    const normalized = normalizeCreateInput(input, cipher)
    const isDefault = input.setAsDefault === true
    let probeResult: StorageProbeView['result'] | null = null
    let probeMessage: string | null = null
    let probedAt: Date | null = null
    if (isDefault) {
      // 设为默认前必须先证明桶可读写；探测是外部调用，放在数据库事务外执行。
      const probe = await createS3StorageAdapter({
        endpoint: normalized.endpoint,
        region: normalized.region,
        bucketName: normalized.bucketName,
        pathPrefix: normalized.pathPrefix,
        credentials: normalized.credentials,
        probeTimeoutMs,
      }).probe()
      probeResult = probe.result
      probeMessage = probe.message
      probedAt = new Date()
      if (probe.result !== 'read_write') {
        throw new ApiError(ERROR_CODES.STORAGE_BUCKET_NOT_WRITABLE, `储存桶未通过可读写测试：${probe.message}`)
      }
    }

    try {
      const row = await db.transaction(async (tx) => {
        // 单默认桶由部分唯一索引兜底，切换前必须先取消旧默认。
        if (isDefault) await clearDefaultBucket(tx, '')
        const inserted = await insertStorageBucket(tx, {
          id: randomUUID(),
          name: normalized.name,
          kind: 's3',
          isBuiltin: false,
          isDefault,
          status: 'enabled',
          endpoint: normalized.endpoint,
          bucketName: normalized.bucketName,
          region: normalized.region,
          pathPrefix: normalized.pathPrefix,
          accessKeyHint: normalized.accessKeyHint,
          credentialCiphertext: normalized.encrypted.ciphertext,
          credentialIv: normalized.encrypted.iv,
          credentialAuthTag: normalized.encrypted.authTag,
          credentialKeyVersion: normalized.encrypted.keyVersion,
          lastProbeResult: probeResult,
          lastProbeMessage: probeMessage,
          lastProbedAt: probedAt,
          createdByUserId: actor.id,
        })
        await appendStorageBucketEvent(tx, {
          id: randomUUID(),
          bucketId: inserted.id,
          action: 'bucket_created',
          actorUserId: actor.id,
          changes: {
            name: normalized.name,
            kind: 's3',
            endpoint: normalized.endpoint,
            bucketName: normalized.bucketName,
            region: normalized.region,
            pathPrefix: normalized.pathPrefix,
            accessKeyHint: normalized.accessKeyHint,
            isDefault,
          },
        })
        return inserted
      })
      return toStorageBucketView(row)
    } catch (error) {
      if (isUniqueViolation(error)) throw translateUniqueViolation(error, '默认桶已被其他操作切换，请刷新后重试')
      throw error
    }
  }

  async function updateBucket(
    actor: SessionUser,
    bucketId: string,
    input: UpdateStorageBucketInput,
  ): Promise<StorageBucketView> {
    await requirePlatformAdmin(db, actor.id)
    const existing = await requireBucket(bucketId)
    const { patch, changes } = prepareBucketUpdate(existing, input, cipher)
    if (patch.status === 'disabled') {
      if (existing.is_default) {
        throw new ApiError(ERROR_CODES.STORAGE_BUCKET_NOT_WRITABLE, '默认储存桶不能停用，请先切换默认桶')
      }
      // 停用会让历史附件不可下载，必须按引用数拒绝并说明数量。
      const attachmentCount = await countAttachmentsByBucket(db, bucketId)
      if (attachmentCount > 0) {
        throw new ApiError(ERROR_CODES.STORAGE_BUCKET_IN_USE, `该储存桶仍被 ${attachmentCount} 个附件引用，不能停用`, {
          attachmentCount,
        })
      }
    }

    try {
      const row = await db.transaction(async (tx) => {
        const updated = await updateStorageBucketByVersion(tx, bucketId, input.version, patch)
        if (!updated) throw new ApiError(ERROR_CODES.VERSION_CONFLICT, '储存桶已被其他操作修改，请刷新后重试')
        if (Object.keys(changes).length > 0) {
          await appendStorageBucketEvent(tx, {
            id: randomUUID(),
            bucketId,
            action: 'bucket_updated',
            actorUserId: actor.id,
            changes,
          })
        }
        return updated
      })
      return toStorageBucketView(row)
    } catch (error) {
      if (isUniqueViolation(error)) throw translateUniqueViolation(error, '储存桶已被其他操作修改，请刷新后重试')
      throw error
    }
  }

  async function probeBucket(actor: SessionUser, bucketId: string): Promise<StorageProbeView> {
    await requirePlatformAdmin(db, actor.id)
    const bucket = await requireBucket(bucketId)
    let outcome: { result: StorageProbeView['result']; message: string }
    try {
      // 探测是外部 I/O，必须在事务外执行；适配器会解密凭据但不会输出到日志或响应。
      outcome = await storage.adapterFor(bucket).probe()
    } catch (error) {
      throw new ApiError(
        ERROR_CODES.STORAGE_BUCKET_PROBE_FAILED,
        error instanceof Error ? error.message : '储存桶连接测试失败',
      )
    }
    const checkedAt = new Date()
    const row = await db.transaction(async (tx) => {
      const updated = await updateStorageBucketProbe(tx, bucketId, {
        result: outcome.result,
        message: outcome.message,
        at: checkedAt,
      })
      if (!updated) throw new ApiError(ERROR_CODES.STORAGE_BUCKET_NOT_FOUND, '储存桶不存在或已被删除')
      await appendStorageBucketEvent(tx, {
        id: randomUUID(),
        bucketId,
        action: 'bucket_probed',
        actorUserId: actor.id,
        changes: { result: outcome.result, message: outcome.message },
      })
      return updated
    })
    return {
      result: outcome.result,
      message: outcome.message,
      checkedAt: row.last_probed_at?.toISOString() ?? checkedAt.toISOString(),
    }
  }

  async function setDefaultBucket(actor: SessionUser, bucketId: string, version: number): Promise<StorageBucketView> {
    await requirePlatformAdmin(db, actor.id)
    const bucket = await requireBucket(bucketId)
    if (bucket.status !== 'enabled') {
      throw new ApiError(ERROR_CODES.STORAGE_BUCKET_NOT_WRITABLE, '储存桶已停用，不能设为默认')
    }
    // 内置本地桶天然满足可读写；S3 桶必须最近一次探测为 read_write。
    if (!bucket.is_builtin && bucket.last_probe_result !== 'read_write') {
      throw new ApiError(ERROR_CODES.STORAGE_BUCKET_NOT_WRITABLE, '请先完成连接测试并确认储存桶可读写')
    }
    try {
      const row = await db.transaction(async (tx) => {
        await clearDefaultBucket(tx, bucketId)
        const updated = await updateStorageBucketByVersion(tx, bucketId, version, { isDefault: true })
        if (!updated) throw new ApiError(ERROR_CODES.VERSION_CONFLICT, '储存桶已被其他操作修改，请刷新后重试')
        await appendStorageBucketEvent(tx, {
          id: randomUUID(),
          bucketId,
          action: 'bucket_set_default',
          actorUserId: actor.id,
          changes: { isDefault: true },
        })
        return updated
      })
      return toStorageBucketView(row)
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ApiError(ERROR_CODES.VERSION_CONFLICT, '默认桶已被其他操作切换，请刷新后重试')
      }
      throw error
    }
  }

  async function removeBucket(actor: SessionUser, bucketId: string): Promise<{ id: string; removed: true }> {
    await requirePlatformAdmin(db, actor.id)
    const bucket = await requireBucket(bucketId)
    if (bucket.is_builtin) {
      throw new ApiError(ERROR_CODES.STORAGE_BUCKET_BUILTIN_PROTECTED, '内置本地储存桶不能删除')
    }
    if (bucket.is_default) {
      throw new ApiError(ERROR_CODES.STORAGE_BUCKET_NOT_WRITABLE, '默认储存桶不能删除，请先切换默认桶')
    }
    await db.transaction(async (tx) => {
      const attachmentCount = await countAttachmentsByBucket(tx, bucketId)
      if (attachmentCount > 0) {
        throw new ApiError(ERROR_CODES.STORAGE_BUCKET_IN_USE, `该储存桶仍被 ${attachmentCount} 个附件引用，不能删除`, {
          attachmentCount,
        })
      }
      const removed = await deleteStorageBucket(tx, bucketId)
      if (!removed) throw new ApiError(ERROR_CODES.STORAGE_BUCKET_NOT_FOUND, '储存桶不存在或已被删除')
      await appendStorageBucketEvent(tx, {
        id: randomUUID(),
        bucketId,
        action: 'bucket_removed',
        actorUserId: actor.id,
        changes: { name: bucket.name },
      })
    })
    return { id: bucketId, removed: true }
  }

  return { listBuckets, createBucket, updateBucket, probeBucket, setDefaultBucket, removeBucket }
}
