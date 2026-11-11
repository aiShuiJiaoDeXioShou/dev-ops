/** 储存桶功能对外出口：页面只从 public.ts 引用本 feature 的类型与界面。 */

export { STORAGE_BUCKETS_QUERY_KEY, storageBucketsQueryOptions } from './api/queries'
export { describeStorageError } from './lib/errors'
export {
  BUCKET_KIND_LABELS,
  BUCKET_STATUS_LABELS,
  PROBE_RESULT_LABELS,
  bucketDefaultBlockedReason,
  bucketRemoveBlockedReason,
  canRemoveBucket,
  canSetBucketDefault,
} from './model/labels'
export type {
  CreateStorageBucketInput,
  StorageBucket,
  StorageBucketKind,
  StorageBucketStatus,
  StorageProbe,
  StorageProbeResult,
  UpdateStorageBucketInput,
} from './model/types'
export { StorageBucketManagement } from './ui/storage-bucket-management'
