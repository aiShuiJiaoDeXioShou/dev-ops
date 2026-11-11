import { useQuery } from '@tanstack/react-query'
import { describeRequestError } from '@/shared/api/errors'
import { formatDateTime } from '@/shared/lib/format'
import { Button } from '@/shared/ui/controls/button'
import { LogSheet } from '@/shared/ui/log-sheet'
import { StatusBadge } from '@/shared/ui/status-badge'
import { toolInvocationsQueryOptions } from '../api/queries'

/** 写能力调用状态到可读标签。 */
const INVOCATION_STATUS_LABELS: Record<string, string> = {
  queued: '排队中',
  running: '执行中',
  succeeded: '成功',
  failed: '失败',
  cancelled: '已取消',
}

/** 写能力调用状态到统一状态色。 */
const INVOCATION_STATUS_TONES: Record<string, 'neutral' | 'info' | 'success' | 'warning' | 'danger'> = {
  queued: 'warning',
  running: 'info',
  succeeded: 'success',
  failed: 'danger',
  cancelled: 'neutral',
}

/** 写能力名称到业务可读名。 */
const CAPABILITY_LABELS: Record<string, string> = {
  code_change: '代码变更',
  create_pull_request: '创建 PR',
  create_issue: '创建 Issue',
  add_comment: '添加评论',
}

/**
 * 写能力调用日志抽屉：由代码页工具栏的小日志图标打开，页面不再平铺调用记录。
 * @param props.projectId 项目标识；open 打开状态；onOpenChange 状态回调。
 * @returns 调用记录侧边抽屉；数据按需加载。
 */
export function CodeInvocationLogSheet({
  projectId,
  open,
  onOpenChange,
}: {
  projectId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const invocations = useQuery({ ...toolInvocationsQueryOptions(projectId), enabled: Boolean(projectId) && open })
  return (
    <LogSheet
      open={open}
      onOpenChange={onOpenChange}
      title="写能力调用记录"
      description="CLI 与 Bot 对当前项目发起的写操作，最近 5 条"
      footer={<p className="small muted">调用记录只保留摘要；敏感参数不会出现在这里。</p>}
    >
      {invocations.isPending ? (
        <p className="small quiet">调用记录加载中…</p>
      ) : invocations.isError ? (
        <div className="inline-error" role="alert">
          <span>调用记录读取失败：{describeRequestError(invocations.error).description}</span>
          <Button type="button" variant="outline" size="sm" onClick={() => void invocations.refetch()}>
            重新加载
          </Button>
        </div>
      ) : (invocations.data?.data.items ?? []).length === 0 ? (
        <p className="small quiet">还没有写能力调用记录。</p>
      ) : (
        <ul className="invocation-list invocation-list-panel">
          {(invocations.data?.data.items ?? []).slice(0, 5).map((item) => (
            <li key={item.id} className="invocation-row">
              <div className="invocation-main">
                <StatusBadge tone={INVOCATION_STATUS_TONES[item.status] ?? 'neutral'}>
                  {INVOCATION_STATUS_LABELS[item.status] ?? item.status}
                </StatusBadge>
                <strong>{CAPABILITY_LABELS[item.capability] ?? item.capability}</strong>
                <span className="quiet">· {item.channel === 'cli' ? 'CLI' : item.channel}</span>
              </div>
              <time className="invocation-time" dateTime={item.createdAt}>
                {formatDateTime(item.createdAt)}
              </time>
              {item.errorMessage ? (
                <p className="invocation-error">
                  {item.errorCode ? `${item.errorCode}：` : ''}
                  {item.errorMessage}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </LogSheet>
  )
}
