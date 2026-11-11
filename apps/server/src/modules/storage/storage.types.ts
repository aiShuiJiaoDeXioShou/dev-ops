import type { Database } from '../../platform/database/client.ts'
import type { SecretCipher } from '../configuration/configuration.crypto.ts'
import type { SessionUser } from '../identity/identity.session.ts'
import type { StorageService } from './storage.service.ts'
import type { StorageBucketView } from './storage.view.ts'

/** 创建储存桶输入；kind 首期只允许 s3。 */
export interface CreateStorageBucketInput {
  name: string
  kind: 's3'
  endpoint: string
  bucketName: string
  region?: string
  pathPrefix?: string | null
  accessKeyId: string
  secretAccessKey: string
  setAsDefault?: boolean
}

/** 更新储存桶输入；undefined 表示保持原值。 */
export interface UpdateStorageBucketInput {
  version: number
  name?: string
  endpoint?: string
  bucketName?: string
  region?: string
  pathPrefix?: string | null
  accessKeyId?: string
  secretAccessKey?: string
  status?: 'enabled' | 'disabled'
}

/** 探测结论视图。 */
export interface StorageProbeView {
  result: 'read_write' | 'read_only' | 'unreachable' | 'auth_failed'
  message: string
  checkedAt: string
}

/** 储存桶管理服务公开能力；全部用例仅平台管理员可用。 */
export interface StorageManagementService {
  /** 列出全部储存桶；按内置桶、默认桶、创建时间倒序稳定排序。 */
  listBuckets(actor: SessionUser): Promise<StorageBucketView[]>
  /** 创建 S3 兼容桶；凭据加密保存，可选在创建前完成可读写验证并设为默认。 */
  createBucket(actor: SessionUser, input: CreateStorageBucketInput): Promise<StorageBucketView>
  /** 更新桶配置；使用版本乐观锁与名称唯一约束。 */
  updateBucket(actor: SessionUser, bucketId: string, input: UpdateStorageBucketInput): Promise<StorageBucketView>
  /** 测试连接并持久化探测结论。 */
  probeBucket(actor: SessionUser, bucketId: string): Promise<StorageProbeView>
  /** 设为默认桶；要求启用且最近探测为可读写。 */
  setDefaultBucket(actor: SessionUser, bucketId: string, version: number): Promise<StorageBucketView>
  /** 删除未被引用的非默认、非内置桶。 */
  removeBucket(actor: SessionUser, bucketId: string): Promise<{ id: string; removed: true }>
}

/** 储存桶管理服务依赖。 */
export interface StorageManagementServiceOptions {
  db: Database
  cipher: SecretCipher | null
  storage: StorageService
  /** 探测超时；与 STORAGE_PROBE_TIMEOUT_MS 一致。 */
  probeTimeoutMs: number
}
