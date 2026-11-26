import { useQuery } from '@tanstack/react-query'
import { Inbox } from 'lucide-react'
import { Link } from 'react-router'
import { formatDateTime } from '@/shared/lib/format'
import { Button } from '@/shared/ui/controls/button'
import { CompactListSkeleton } from '@/shared/ui/page-skeleton'
import { EmptyState, PageError } from '@/shared/ui/page-state'
import { botInboxOptions } from '../api/queries'

const reasons = [{ id: 'awaiting_reply', label: '等你回复' }] as const

/** 展示当前成员可见且等待回复的会话，链接回会话继续沟通。 */
export function BotInbox({ teamId }: { teamId: string }) {
  const inbox = useQuery(botInboxOptions(teamId))
  return (
    <div className="work-padding overflow-y-auto">
      <h2>等你回复</h2>
      {inbox.isPending && <CompactListSkeleton rows={4} bordered label="等待回复的会话加载中" />}
      {inbox.isError && <PageError title="会话汇总加载失败" error={inbox.error} onRetry={() => void inbox.refetch()} />}
      {inbox.data?.data.items.length === 0 && <EmptyState icon={<Inbox />} title="暂无等待回复的会话" />}
      {reasons.map(({ id, label }) => {
        const items = inbox.data?.data.items.filter(({ reason }) => reason === id) ?? []
        if (!items.length) return null
        return (
          <section key={id} className="work-gap">
            <h3>{label}</h3>
            {items.map((conversation) => (
              <Button key={conversation.id} asChild variant="ghost" className="work-task-row">
                <Link to={`/collaboration/${conversation.conversationId}`}>
                  <strong>{conversation.conversationName}</strong>
                  <span className="small muted">
                    {conversation.conversationName} · {formatDateTime(conversation.updatedAt)}
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
