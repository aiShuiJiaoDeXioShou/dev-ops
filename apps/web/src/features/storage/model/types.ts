import type { ApiBody, ApiSuccessData } from '@dev-ops/api-client'

/** 平台储存桶列表项接口形状；服务端只返回掩码与探测信息。 */
export type StorageBucket = ApiSuccessData<'/api/v1/platform/storage-buckets', 'get'>['buckets'][number]

/** 储存桶类型；local 为内置本地桶，s3 为 S3 兼容自定义桶。 */
export type StorageBucketKind = StorageBucket['kind']

/** 储存桶启用状态。 */
export type StorageBucketStatus = StorageBucket['status']

/** 最近一次连接探测结论。 */
export type StorageProbeResult = NonNullable<StorageBucket['lastProbe']>['result']

/** 连接测试响应；结论同时持久化到桶记录。 */
export type StorageProbe = ApiSuccessData<'/api/v1/platform/storage-buckets/{bucketId}/test', 'post'>

/** 创建储存桶请求体。 */
export type CreateStorageBucketInput = ApiBody<'/api/v1/platform/storage-buckets', 'post'>

/** 更新储存桶请求体；secretAccessKey 省略表示保持原值。 */
export type UpdateStorageBucketInput = ApiBody<'/api/v1/platform/storage-buckets/{bucketId}/update', 'post'>
