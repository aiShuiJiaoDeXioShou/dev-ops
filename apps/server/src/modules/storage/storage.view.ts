import type { StorageProbeResult } from './adapters/local.adapter.ts'
import type { StorageBucketRow } from './storage.repository.ts'

/** 储存桶类型；与数据库 CHECK 取值一致。 */
export type StorageBucketKind = 'local' | 's3'

/** 储存桶启用状态；与数据库 CHECK 取值一致。 */
export type StorageBucketStatus = 'enabled' | 'disabled'

/** 储存桶最近一次探测结果；仅用于展示。 */
export interface StorageBucketProbeView {
  result: StorageProbeResult
  message: string | null
  at: string | null
}

/**
 * 储存桶对外视图。
 * @remarks 只含掩码与探测信息；绝不包含 credential_* 列、完整 Access Key ID 或 Secret。
 */
export interface StorageBucketView {
  id: string
  name: string
  kind: StorageBucketKind
  isBuiltin: boolean
  isDefault: boolean
  status: StorageBucketStatus
  endpoint: string | null
  bucketName: string | null
  region: string | null
  pathPrefix: string | null
  accessKeyHint: string | null
  lastProbe: StorageBucketProbeView | null
  version: number
  updatedAt: string
}

/** 判断数据库 text 值是否为合法桶类型。 */
export function isStorageBucketKind(value: string): value is StorageBucketKind {
  return value === 'local' || value === 's3'
}

/** 判断数据库 text 值是否为合法启用状态。 */
export function isStorageBucketStatus(value: string): value is StorageBucketStatus {
  return value === 'enabled' || value === 'disabled'
}

/** 判断数据库 text 值是否为合法探测结论。 */
export function isStorageProbeResult(value: string): value is StorageProbeResult {
  return value === 'read_write' || value === 'read_only' || value === 'unreachable' || value === 'auth_failed'
}

/**
 * 把持久化行映射为对外视图。
 * @param row 储存桶行。
 * @returns 掩码后的桶视图。
 * @throws 数据库中的类型、状态或探测结论不合法时抛出普通 Error（数据异常，不伪装为客户输入错误）。
 */
export function toStorageBucketView(row: StorageBucketRow): StorageBucketView {
  if (!isStorageBucketKind(row.kind)) throw new Error('数据库储存桶类型不合法')
  if (!isStorageBucketStatus(row.status)) throw new Error('数据库储存桶状态不合法')
  if (row.last_probe_result !== null && !isStorageProbeResult(row.last_probe_result)) {
    throw new Error('数据库储存桶探测结论不合法')
  }
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    isBuiltin: row.is_builtin,
    isDefault: row.is_default,
    status: row.status,
    endpoint: row.endpoint,
    bucketName: row.bucket_name,
    region: row.region,
    pathPrefix: row.path_prefix,
    accessKeyHint: row.access_key_hint,
    lastProbe:
      row.last_probe_result === null
        ? null
        : {
            result: row.last_probe_result,
            message: row.last_probe_message,
            at: row.last_probed_at?.toISOString() ?? null,
          },
    version: row.version,
    updatedAt: row.updated_at.toISOString(),
  }
}
