import { queryOptions, useQuery } from '@tanstack/react-query'
import { fetchAttachmentPolicy } from './attachments-api'

/** 附件相关查询的键约定；详情列表随业务详情返回，策略单独缓存。 */
export const attachmentKeys = {
  all: ['attachments'] as const,
  policy: () => [...attachmentKeys.all, 'policy'] as const,
}

/**
 * 附件上传策略查询；策略来自服务端集中配置，短时间内不会变化，缓存 5 分钟。
 * @returns 供 useQuery 使用的查询选项。
 */
export function attachmentPolicyQueryOptions() {
  return queryOptions({
    queryKey: attachmentKeys.policy(),
    queryFn: ({ signal }) => fetchAttachmentPolicy(signal),
    staleTime: 5 * 60_000,
  })
}

/**
 * 在附件表单中读取上传策略，用于前置校验与上限提示。
 * @returns 包含 loading/error/data 的策略查询结果。
 */
export function useAttachmentPolicy() {
  return useQuery(attachmentPolicyQueryOptions())
}
