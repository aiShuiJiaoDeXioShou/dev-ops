import { useQuery } from '@tanstack/react-query'
import { useParams } from 'react-router'
import { pipelineRunsQueryOptions } from '@/features/delivery/public'
import { describeRequestError } from '@/shared/api/errors'
import { Button } from '@/shared/ui/controls/button'
import { DelayedPageLoading, EmptyState } from '@/shared/ui/page-state'

const STATUS_LABELS: Record<string, string> = {
  queued: '排队中',
  running: '运行中',
  succeeded: '成功',
  failed: '失败',
  cancelled: '已取消',
  unknown: '未知',
}

/** 项目流水线页：只展示外部上报的运行记录，不触发执行。 */
export function Component() {
  const { projectId = '' } = useParams()
  const runs = useQuery(pipelineRunsQueryOptions(projectId, { page: 1, pageSize: 20 }))
  if (runs.isPending) return <DelayedPageLoading />
  if (runs.isError) {
    return (
      <EmptyState
        title="流水线记录加载失败"
        description={describeRequestError(runs.error).description}
        action={
          <Button type="button" onClick={() => void runs.refetch()}>
            重新加载
          </Button>
        }
      />
    )
  }
  if (runs.data.data.items.length === 0) {
    return <EmptyState mascot="signal" title="暂无流水线运行" description="外部 CI 上报运行结果后会显示在这里。" />
  }
  return (
    <div className="project-tab-panel">
      <ul className="plain-list">
        {runs.data.data.items.map((run) => (
          <li key={run.id}>
            <span>{run.pipelineName}</span>
            <span className="tag">{STATUS_LABELS[run.status] ?? run.status}</span>
            <span className="muted">{run.commitRef ?? '未提供提交'}</span>
            <span className="muted">{run.startedAt ?? '未开始'}</span>
            {run.resultUrl ? (
              <a href={run.resultUrl} target="_blank" rel="noreferrer">
                查看结果
              </a>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  )
}

export default Component
