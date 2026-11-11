import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { success } from '../../platform/http/response.ts'
import type { IdentityAuth } from '../identity/identity.auth.ts'
import { requireSessionUser } from '../identity/identity.session.ts'
import {
  createStorageBucketBodySchema,
  setDefaultStorageBucketBodySchema,
  storageBucketListResponseSchema,
  storageBucketParamsSchema,
  storageBucketProbeResponseSchema,
  storageBucketRemoveResponseSchema,
  storageBucketResponseSchema,
  updateStorageBucketBodySchema,
} from './storage.schema.ts'
import type { StorageManagementService } from './storage.management.service.ts'

/**
 * 平台储存桶管理路由；仅平台管理员可用。
 * @param app Fastify 插件实例。
 * @param options 认证实例与储存桶管理服务。
 * @returns 无返回值；只注册 GET 与 POST，全部返回统一信封。
 * @remarks 路由只负责 HTTP 输入输出与身份解析；平台管理员校验在 service 内再次执行，
 * 避免未来新增调用路径时绕过权限。响应只含掩码与探测结论，绝不返回凭据。
 */
export const storageRoutes: FastifyPluginAsyncTypebox<{
  auth: IdentityAuth
  service: StorageManagementService
}> = async (app, options) => {
  app.get(
    '/platform/storage-buckets',
    {
      schema: {
        response: { 200: storageBucketListResponseSchema },
        description:
          '列出平台储存桶配置，按内置桶、默认桶、创建时间倒序稳定排序；仅返回 Access Key 掩码与最近探测结论。',
      },
    },
    async (request) => {
      const user = await requireSessionUser(options.auth, request.headers)
      return success({ buckets: await options.service.listBuckets(user) }, request.id)
    },
  )

  app.post(
    '/platform/storage-buckets',
    {
      schema: {
        body: createStorageBucketBodySchema,
        response: { 200: storageBucketResponseSchema },
        description:
          '创建 S3 兼容储存桶；首期 kind 只允许 s3。凭据加密保存，响应只返回掩码。setAsDefault=true 时先执行可读写探测，未通过则不创建。',
      },
    },
    async (request) => {
      const user = await requireSessionUser(options.auth, request.headers)
      return success(await options.service.createBucket(user, request.body), request.id)
    },
  )

  app.post(
    '/platform/storage-buckets/:bucketId/update',
    {
      schema: {
        params: storageBucketParamsSchema,
        body: updateStorageBucketBodySchema,
        response: { 200: storageBucketResponseSchema },
        description:
          '更新储存桶配置；version 用于乐观锁，Secret Access Key 省略表示保持原值。内置本地桶只允许改名，不允许改接入参数与状态。',
      },
    },
    async (request) => {
      const user = await requireSessionUser(options.auth, request.headers)
      return success(await options.service.updateBucket(user, request.params.bucketId, request.body), request.id)
    },
  )

  app.post(
    '/platform/storage-buckets/:bucketId/test',
    {
      schema: {
        params: storageBucketParamsSchema,
        response: { 200: storageBucketProbeResponseSchema },
        description:
          '测试储存桶连接：写探针对象、读回校验、删除探针；按 read_write/read_only/unreachable/auth_failed 归因，结论持久化到桶记录并写审计。超时由 STORAGE_PROBE_TIMEOUT_MS 控制。',
      },
    },
    async (request) => {
      const user = await requireSessionUser(options.auth, request.headers)
      return success(await options.service.probeBucket(user, request.params.bucketId), request.id)
    },
  )

  app.post(
    '/platform/storage-buckets/:bucketId/set-default',
    {
      schema: {
        params: storageBucketParamsSchema,
        body: setDefaultStorageBucketBodySchema,
        response: { 200: storageBucketResponseSchema },
        description:
          '设为默认储存桶；要求桶已启用且最近一次探测为 read_write（内置本地桶天然满足）。同一时刻只允许一个默认桶。',
      },
    },
    async (request) => {
      const user = await requireSessionUser(options.auth, request.headers)
      return success(
        await options.service.setDefaultBucket(user, request.params.bucketId, request.body.version),
        request.id,
      )
    },
  )

  app.post(
    '/platform/storage-buckets/:bucketId/remove',
    {
      schema: {
        params: storageBucketParamsSchema,
        response: { 200: storageBucketRemoveResponseSchema },
        description:
          '删除储存桶；内置桶、当前默认桶以及仍被附件引用的桶都会被拒绝。删除动作写入平台级审计，审计记录保留。',
      },
    },
    async (request) => {
      const user = await requireSessionUser(options.auth, request.headers)
      return success(await options.service.removeBucket(user, request.params.bucketId), request.id)
    },
  )
}
