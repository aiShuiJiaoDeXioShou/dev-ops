import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/shared/api/client'
import type { CreateStorageBucketInput, StorageBucket, StorageProbe, UpdateStorageBucketInput } from '../model/types'

/** 储存桶列表的查询键；所有写操作成功后统一失效它。 */
export const STORAGE_BUCKETS_QUERY_KEY = ['storage', 'buckets'] as const

/**
 * 读取平台储存桶列表；排序由服务端保证稳定。
 * @returns 储存桶列表查询选项；仅平台管理员可访问。
 */
export function storageBucketsQueryOptions() {
  return queryOptions({
    queryKey: STORAGE_BUCKETS_QUERY_KEY,
    queryFn: async ({ signal }): Promise<StorageBucket[]> => {
      const result = await apiClient.listStorageBuckets({ signal })
      return result.data.buckets
    },
  })
}

/**
 * 写操作成功后失效储存桶列表，保证默认标记与探测结论与列表一致。
 * @returns 无参数失效函数；由各 mutation 的 onSuccess 调用。
 */
function useInvalidateStorageBuckets() {
  const queryClient = useQueryClient()
  return () => queryClient.invalidateQueries({ queryKey: STORAGE_BUCKETS_QUERY_KEY })
}

/**
 * 创建 S3 兼容储存桶。
 * @returns 创建变更；成功后刷新列表，凭据只写不读。
 */
export function useCreateStorageBucket() {
  const invalidate = useInvalidateStorageBuckets()
  return useMutation({
    mutationFn: async (input: CreateStorageBucketInput): Promise<StorageBucket> => {
      const result = await apiClient.createStorageBucket(input)
      return result.data
    },
    onSuccess: invalidate,
  })
}

/**
 * 更新储存桶配置。
 * @returns 更新变更；成功后刷新列表。
 */
export function useUpdateStorageBucket() {
  const invalidate = useInvalidateStorageBuckets()
  return useMutation({
    mutationFn: async (input: { bucketId: string; body: UpdateStorageBucketInput }): Promise<StorageBucket> => {
      const result = await apiClient.updateStorageBucket(input.bucketId, input.body)
      return result.data
    },
    onSuccess: invalidate,
  })
}

/**
 * 测试储存桶连接；结论由服务端持久化。
 * @returns 测试变更；成功后刷新列表以同步最近探测结论。
 */
export function useTestStorageBucket() {
  const invalidate = useInvalidateStorageBuckets()
  return useMutation({
    mutationFn: async (bucketId: string): Promise<StorageProbe> => {
      const result = await apiClient.testStorageBucket(bucketId)
      return result.data
    },
    onSuccess: invalidate,
  })
}

/**
 * 设为默认储存桶；版本用于乐观锁。
 * @returns 设为默认变更；成功后刷新列表。
 */
export function useSetStorageBucketDefault() {
  const invalidate = useInvalidateStorageBuckets()
  return useMutation({
    mutationFn: async (input: { bucketId: string; version: number }): Promise<StorageBucket> => {
      const result = await apiClient.setStorageBucketDefault(input.bucketId, { version: input.version })
      return result.data
    },
    onSuccess: invalidate,
  })
}

/**
 * 删除储存桶；内置桶、默认桶与被引用桶由服务端拒绝。
 * @returns 删除变更；成功后刷新列表。
 */
export function useRemoveStorageBucket() {
  const invalidate = useInvalidateStorageBuckets()
  return useMutation({
    mutationFn: async (bucketId: string): Promise<{ id: string }> => {
      const result = await apiClient.removeStorageBucket(bucketId)
      return result.data
    },
    onSuccess: invalidate,
  })
}
