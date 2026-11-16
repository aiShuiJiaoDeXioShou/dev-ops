import type { QueryClient } from '@tanstack/react-query'
import { RequestError, type ApiBody } from '@dev-ops/api-client'
import { apiClient } from '@/shared/api/client'

type Update =
  | { kind: 'requirement'; id: string; body: ApiBody<'/api/v1/requirements/{requirementId}/update', 'post'> }
  | { kind: 'bug'; id: string; body: ApiBody<'/api/v1/bugs/{bugId}/update', 'post'> }

/**
 * 保存详情中的局部编辑并同步详情、列表及操作记录。
 * @param client 当前应用的查询缓存。
 * @param update 事项类型、标识、保存时的版本及本次修改字段。
 * @returns 事项保存并完成缓存同步后结束的 Promise。
 * @throws 请求或业务校验失败时向编辑器传递错误。版本冲突时同时获取最新详情。
 */
export async function saveWorkItemUpdate(client: QueryClient, update: Update): Promise<void> {
  const namespace = update.kind === 'bug' ? 'bugs' : 'requirements'
  const detailKey = [namespace, 'detail', update.id]
  try {
    const result =
      update.kind === 'bug'
        ? await apiClient.updateBug(update.id, update.body)
        : await apiClient.updateRequirement(update.id, update.body)
    await client.cancelQueries({ queryKey: detailKey })
    client.setQueryData(detailKey, result)
    await Promise.all([
      client.invalidateQueries({ queryKey: [namespace, 'list', result.data.projectId] }),
      client.invalidateQueries({ queryKey: ['collaboration', 'activities', update.kind, update.id] }),
      client.invalidateQueries({ queryKey: ['projects', 'activity'] }),
    ])
  } catch (cause) {
    if (cause instanceof RequestError && cause.serverCode === 'VERSION_CONFLICT') {
      await client.invalidateQueries({ queryKey: detailKey })
    }
    throw cause
  }
}
