import { useQuery } from '@tanstack/react-query'
import { formatDateTime } from '@/shared/lib/format'
import { DelayedPageLoading } from '@/shared/ui/page-state'
import { activitiesQueryOptions, type CollabTarget } from '../api/queries'

const ACTION_LABELS: Record<string, string> = {
  requirement_created: '创建需求',
  requirement_updated: '更新需求',
  test_submitted: '提测',
  test_started: '开始测试',
  test_withdrawn: '撤回测试',
  test_returned: '退回开发',
  test_passed: '测试通过',
  development_reopened: '重新开发',
  requirement_cancelled: '取消需求',
  requirement_restored: '恢复需求',
  bug_created: '创建 Bug',
  bug_updated: '更新 Bug',
  fix_started: '开始修复',
  regression_submitted: '提交回归',
  regression_withdrawn: '撤回回归',
  regression_passed: '回归通过',
  regression_failed: '回归失败',
  bug_closed: '关闭 Bug',
  bug_reopened: '重开 Bug',
  requirement_linked: '关联需求',
  requirement_unlinked: '移除需求关联',
  code_reference_removed: '移除代码引用',
}

/** 事项活动时间线。 */
export function ActivityTimeline({ target, targetId }: { target: CollabTarget; targetId: string }) {
  const query = useQuery(activitiesQueryOptions(target, targetId))
  if (query.isPending) return <DelayedPageLoading message="活动加载中…" />
  if (query.isError)
    return (
      <p role="alert" className="text-sm text-destructive">
        活动加载失败。
      </p>
    )
  const activities = query.data.data.items
  if (activities.length === 0) return <p className="text-sm text-muted-foreground">暂无活动记录。</p>
  return (
    <ol className="relative space-y-4 border-l pl-4">
      {activities.map((activity) => (
        <li key={activity.id} className="space-y-1">
          <p className="text-sm">{ACTION_LABELS[activity.action] ?? activity.action}</p>
          <p className="text-xs text-muted-foreground">{formatDateTime(activity.createdAt)}</p>
          {activity.note && <p className="text-sm text-muted-foreground">{activity.note}</p>}
          {activity.reason && <p className="text-sm text-muted-foreground">原因：{activity.reason}</p>}
        </li>
      ))}
    </ol>
  )
}
