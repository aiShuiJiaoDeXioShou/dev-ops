import { useQuery } from '@tanstack/react-query'
import { Markdown } from '@/shared/lib/markdown'
import { formatDateTime } from '@/shared/lib/format'
import { UserAvatar } from '@/shared/ui/user-avatar'
import { Button } from '@/shared/ui/controls/button'
import { DelayedPageLoading } from '@/shared/ui/page-state'
import { commentsQueryOptions, type CollabTarget } from '../api/queries'
import './comment-list.css'

/**
 * 展示事项评论的作者、时间和正文。
 * @param props 事项类型与标识。
 * @returns 评论列表或加载失败时可重试的反馈。
 */
export function CommentList({ target, targetId }: { target: CollabTarget; targetId: string }) {
  const query = useQuery(commentsQueryOptions(target, targetId))
  if (query.isPending) return <DelayedPageLoading message="评论加载中…" />
  if (query.isError)
    return (
      <div className="space-y-2">
        <p role="alert" className="text-sm text-destructive">
          评论加载失败，请重试。
        </p>
        <Button type="button" variant="outline" size="sm" onClick={() => void query.refetch()}>
          重试
        </Button>
      </div>
    )
  const comments = query.data.data.items
  if (comments.length === 0) return <p className="text-sm text-muted-foreground">还没有评论。</p>
  return (
    <ul className="space-y-4">
      {comments.map((comment) => (
        <li key={comment.id} className="rounded-lg border bg-card p-4">
          <div className="flex flex-wrap items-center gap-2">
            <UserAvatar name={comment.authorName} image={comment.authorImage} toneSeed={comment.authorUserId} />
            <span className="text-sm font-medium wrap-anywhere">{comment.authorName}</span>
            <time dateTime={comment.createdAt} className="text-xs text-muted-foreground">
              {formatDateTime(comment.createdAt)}
            </time>
          </div>
          <div className="comment-markdown mt-2 min-w-0 text-sm wrap-anywhere">
            <Markdown>{comment.bodyMarkdown}</Markdown>
          </div>
        </li>
      ))}
    </ul>
  )
}
