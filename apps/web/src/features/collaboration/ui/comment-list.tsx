import { useQuery } from '@tanstack/react-query'
import { formatDateTime } from '@/shared/lib/format'
import { DelayedPageLoading } from '@/shared/ui/page-state'
import { commentsQueryOptions, type CollabTarget } from '../api/queries'

/** 事项评论列表。 */
export function CommentList({ target, targetId }: { target: CollabTarget; targetId: string }) {
  const query = useQuery(commentsQueryOptions(target, targetId))
  if (query.isPending) return <DelayedPageLoading message="评论加载中…" />
  if (query.isError)
    return (
      <p role="alert" className="text-sm text-destructive">
        评论加载失败，请稍后重试。
      </p>
    )
  const comments = query.data.data.items
  if (comments.length === 0) return <p className="text-sm text-muted-foreground">还没有评论。</p>
  return (
    <ul className="space-y-4">
      {comments.map((comment) => (
        <li key={comment.id} className="rounded-lg border bg-card p-4">
          <p className="text-xs text-muted-foreground">{formatDateTime(comment.createdAt)}</p>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-6">{comment.bodyMarkdown}</p>
        </li>
      ))}
    </ul>
  )
}
