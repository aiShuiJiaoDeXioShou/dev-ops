import { formatDateTime } from '@/shared/lib/format'
import { knowledgeActionLabel } from '../model/labels'
import type { KnowledgeActivityItem } from '../model/types'

/**
 * 展示知识资产活动记录；只显示动作、时间与安全变更摘要。
 * @param props.items 活动分页条目。
 * @param props.emptyText 无活动时的说明。
 */
export function ActivityTimeline({
  items,
  emptyText = '暂无变更记录',
}: {
  items: KnowledgeActivityItem[]
  emptyText?: string
}) {
  if (items.length === 0) return <p className="text-sm text-muted-foreground">{emptyText}</p>
  return (
    <ol className="space-y-3">
      {items.map((item) => (
        <li key={item.id} className="border-l-2 border-border pl-3">
          <p className="text-sm font-medium">{knowledgeActionLabel(item.action)}</p>
          <p className="text-xs text-muted-foreground">
            {formatDateTime(item.createdAt)} · 操作者 {item.actorUserId.slice(0, 8)}
          </p>
        </li>
      ))}
    </ol>
  )
}
