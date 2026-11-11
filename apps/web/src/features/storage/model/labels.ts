import type { StorageBucket, StorageBucketKind, StorageBucketStatus, StorageProbeResult } from './types'

/** 储存桶类型的中文名称。 */
export const BUCKET_KIND_LABELS: Record<StorageBucketKind, string> = {
  local: '本地储存',
  s3: 'S3 兼容',
}

/** 启用状态的中文名称。 */
export const BUCKET_STATUS_LABELS: Record<StorageBucketStatus, string> = {
  enabled: '启用',
  disabled: '停用',
}

/** 连接探测结论的中文名称；四类结论必须区分，不能统一为成功/失败。 */
export const PROBE_RESULT_LABELS: Record<StorageProbeResult, string> = {
  read_write: '可读写',
  read_only: '只读不可写',
  unreachable: '无法连接',
  auth_failed: '凭据无效',
}

/**
 * 判断是否允许把储存桶设为默认。
 * 服务端要求桶已启用，且自定义桶最近一次探测必须为可读写；内置本地桶天然满足。
 * @param bucket 储存桶视图。
 * @returns 是否可设为默认；false 时界面需给出原因说明。
 */
export function canSetBucketDefault(bucket: StorageBucket): boolean {
  if (bucket.isDefault) return false
  if (bucket.status !== 'enabled') return false
  return bucket.isBuiltin || bucket.lastProbe?.result === 'read_write'
}

/**
 * 生成「设为默认」不可用的原因；可用时返回 null。
 * @param bucket 储存桶视图。
 * @returns 面向用户的原因说明；无需说明时为 null。
 */
export function bucketDefaultBlockedReason(bucket: StorageBucket): string | null {
  if (bucket.isDefault) return '当前已是默认储存桶'
  if (bucket.status !== 'enabled') return '储存桶已停用，不能设为默认'
  if (!bucket.isBuiltin && bucket.lastProbe?.result !== 'read_write') {
    return '请先完成连接测试并确认可读写'
  }
  return null
}

/**
 * 判断是否允许删除储存桶；内置桶与默认桶由服务端保护。
 * @param bucket 储存桶视图。
 * @returns 是否显示可用的删除入口。
 */
export function canRemoveBucket(bucket: StorageBucket): boolean {
  return !bucket.isBuiltin && !bucket.isDefault
}

/**
 * 生成「删除」不可用的原因；可用时返回 null。
 * @param bucket 储存桶视图。
 * @returns 面向用户的原因说明；无需说明时为 null。
 */
export function bucketRemoveBlockedReason(bucket: StorageBucket): string | null {
  if (bucket.isBuiltin) return '内置本地储存桶不可删除'
  if (bucket.isDefault) return '默认储存桶不可删除，请先切换默认桶'
  return null
}
