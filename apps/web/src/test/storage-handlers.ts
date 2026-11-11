import { http, HttpResponse } from 'msw'
import type { StorageBucket, StorageProbeResult } from '@/features/storage/public'

/** 测试用统一成功信封；与 test/server.ts 的 success 保持一致，避免反向引用造成循环依赖。 */
function ok(data: unknown, requestId = 'test-request') {
  return HttpResponse.json(
    { success: true, code: 'OK', message: 'ok', requestId, data },
    { headers: { 'x-request-id': requestId } },
  )
}

/** 内置本地储存桶：默认桶，不允许删除与停用。 */
export const localBucketFixture: StorageBucket = {
  id: '00000000-0000-4000-8000-000000000001',
  name: '内置本地桶',
  kind: 'local',
  isBuiltin: true,
  isDefault: true,
  status: 'enabled',
  endpoint: null,
  bucketName: null,
  region: null,
  pathPrefix: null,
  accessKeyHint: null,
  lastProbe: {
    result: 'read_write',
    message: '本地目录可读写',
    at: '2026-11-11T00:00:00.000Z',
  },
  version: 1,
  updatedAt: '2026-11-11T00:00:00.000Z',
}

/** 已通过可读写探测的自定义桶；可在测试中设为默认。 */
export const s3BucketFixture: StorageBucket = {
  id: '11111111-1111-4111-8111-111111111111',
  name: '生产附件桶',
  kind: 's3',
  isBuiltin: false,
  isDefault: false,
  status: 'enabled',
  endpoint: 'https://s3.example.test',
  bucketName: 'dev-ops-attachments',
  region: 'us-east-1',
  pathPrefix: 'prod/attachments',
  accessKeyHint: 'AKIA***ABCD',
  lastProbe: {
    result: 'read_write',
    message: '写入、读回与删除探针均成功',
    at: '2026-11-11T00:00:00.000Z',
  },
  version: 2,
  updatedAt: '2026-11-11T00:00:00.000Z',
}

/** 尚未测试的自定义桶；未确认可读写前不能设为默认。 */
export const untestedBucketFixture: StorageBucket = {
  ...s3BucketFixture,
  id: '22222222-2222-4222-8222-222222222222',
  name: '待测试桶',
  isDefault: false,
  lastProbe: null,
  version: 1,
}

/**
 * 储存桶列表 handler；测试可按用例传入不同列表。
 * @param buckets 列表返回值，默认返回内置桶与可读写自定义桶。
 * @returns MSW GET handler。
 */
export function storageBucketListHandler(buckets: StorageBucket[] = [localBucketFixture, s3BucketFixture]) {
  return http.get('*/api/v1/platform/storage-buckets', () => ok({ buckets }))
}

/**
 * 连接测试 handler；用于断言四类结论展示。
 * @param result 探测结论。
 * @param message 探测原因。
 * @returns MSW POST handler。
 */
export function storageBucketTestHandler(result: StorageProbeResult, message = '探测原因') {
  return http.post('*/api/v1/platform/storage-buckets/:bucketId/test', () =>
    ok({ result, message, checkedAt: '2026-11-11T00:00:00.000Z' }),
  )
}

/** 默认储存桶列表 handler；未覆盖时让页面测试可正常挂载。 */
export const storageHandlers = [storageBucketListHandler()]
