import { useEffect, useRef } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import type { BotConversation } from '@/features/conversations/api/queries'
import { ConversationIcon } from '@/features/conversations/ui/conversation-icon'
import { Button } from '@/shared/ui/controls/button'
import { DelayedPageSkeleton } from '@/shared/ui/page-skeleton'
import { EmptyState, PageError } from '@/shared/ui/page-state'
import { botTasksOptions, taskStatusLabels } from '../api/queries'
import { TaskDetails } from './task-details'

/** 以原型侧栏查看任务列表及当前任务，关闭后由调用者归还焦点。 */
export function ConversationTaskPanel({
  room,
  taskId,
  readOnly,
  onClose,
  onNew,
  onSelect,
  onChanged,
}: {
  room: BotConversation
  taskId: string | undefined
  readOnly: boolean
  onClose: () => void
  onNew: () => void
  onSelect: (id?: string) => void
  onChanged: () => void
}) {
  const list = useInfiniteQuery(botTasksOptions(room.id))
  const items = list.data?.pages.flatMap(({ data }) => data.items) ?? []
  const closeButton = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    closeButton.current?.focus()
  }, [])
  return (
    <aside className="work-task-panel" aria-label="任务面板">
      <div className="row">
        <h3>{taskId ? '当前任务' : '会话任务'}</h3>
        <span className="spacer" />
        {taskId && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            unstyled
            className="icon-btn"
            aria-label="返回任务列表"
            onClick={() => onSelect()}
          >
            <ArrowLeft className="icon fill-none stroke-current stroke-2" aria-hidden="true" />
          </Button>
        )}
        {!readOnly && !taskId && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            unstyled
            className="icon-btn"
            aria-label="新建协作任务"
            onClick={onNew}
          >
            <ConversationIcon name="plus" />
          </Button>
        )}
        <Button
          ref={closeButton}
          type="button"
          variant="ghost"
          size="icon"
          unstyled
          className="icon-btn"
          aria-label="关闭任务面板"
          onClick={onClose}
        >
          <ConversationIcon name="close" />
        </Button>
      </div>
      {taskId ? (
        <TaskDetails key={taskId} taskId={taskId} room={room} readOnly={readOnly} onChanged={onChanged} />
      ) : (
        <>
          {list.isPending && <DelayedPageSkeleton />}
          {list.isError && <PageError title="任务加载失败" error={list.error} onRetry={() => void list.refetch()} />}
          {list.isSuccess && items.length === 0 && <EmptyState title="还没有任务" />}
          {items.map((task) => (
            <Button
              key={task.id}
              type="button"
              variant="ghost"
              className="work-task-row"
              onClick={() => onSelect(task.id)}
            >
              <strong>{task.title}</strong>
              <span className="spacer" />
              <span className="badge">{taskStatusLabels[task.status]}</span>
            </Button>
          ))}
          {list.hasNextPage && (
            <Button
              type="button"
              variant="ghost"
              disabled={list.isFetchingNextPage}
              onClick={() => void list.fetchNextPage()}
            >
              加载更多任务
            </Button>
          )}
        </>
      )}
    </aside>
  )
}
