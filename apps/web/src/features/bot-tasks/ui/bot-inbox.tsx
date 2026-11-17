import { useQuery } from '@tanstack/react-query'
import { Inbox } from 'lucide-react'
import { Link } from 'react-router'
import { formatDateTime } from '@/shared/lib/format'
import { Button } from '@/shared/ui/controls/button'
import { DelayedPageSkeleton } from '@/shared/ui/page-skeleton'
import { EmptyState, PageError } from '@/shared/ui/page-state'
import { botInboxOptions } from '../api/queries'

const reasons = [
  { id: 'awaiting_review', label: '待验收' },
  { id: 'blocked', label: '受阻' },
] as const

/** 展示当前成员可处理的任务，链接回其会话和任务面板。 */
export function BotInbox({ teamId }: { teamId: string }) {
  const inbox = useQuery(botInboxOptions(teamId))
  return (
    <div className="work-padding overflow-y-auto">
      <h2>待你处理</h2>
      {inbox.isPending && <DelayedPageSkeleton />}
      {inbox.isError && <PageError title="待处理加载失败" error={inbox.error} onRetry={() => void inbox.refetch()} />}
      {inbox.data?.data.items.length === 0 && <EmptyState icon={<Inbox />} title="暂无待处理任务" />}
      {reasons.map(({ id, label }) => {
        const items = inbox.data?.data.items.filter(({ reason }) => reason === id) ?? []
        if (!items.length) return null
        return (
          <section key={id} className="work-gap">
            <h3>{label}</h3>
            {items.map((task) => (
              <Button key={task.id} asChild variant="ghost" className="work-task-row">
                <Link to={`/collaboration/${task.conversationId}?task=${task.id}`}>
                  <strong>{task.taskTitle}</strong>
                  <span className="small muted">
                    {task.conversationName} · {formatDateTime(task.updatedAt)}
                  </span>
                </Link>
              </Button>
            ))}
          </section>
        )
      })}
    </div>
  )
}
