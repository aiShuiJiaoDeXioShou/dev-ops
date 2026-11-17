import { useRef, useState } from 'react'
import { createIdempotencyKey } from '@dev-ops/api-client'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { BotConversation } from '@/features/conversations/api/queries'
import { WorkTagEditor } from '@/features/work-tags/ui/work-tag-editor'
import { apiClient } from '@/shared/api/client'
import { describeRequestError } from '@/shared/api/errors'
import { formatDateTime } from '@/shared/lib/format'
import { Button } from '@/shared/ui/controls/button'
import { Textarea } from '@/shared/ui/controls/textarea'
import { DelayedPageSkeleton } from '@/shared/ui/page-skeleton'
import { PageError } from '@/shared/ui/page-state'
import { HandoffTaskDialog } from './handoff-task-dialog'
import { TaskResults } from './task-results'
import { botTaskOptions, taskQueries, taskStatusLabels, type BotTaskDetail } from '../api/queries'

const runLabels = { queued: '排队中', running: '执行中', succeeded: '已完成', failed: '失败', stopped: '已停止' }
const waitLabels = {
  needs_input: '等待补充信息',
  run_failed: '运行失败，可重新运行',
  executor_unavailable: '执行者不可用',
  stopped: '运行已停止',
}

type TaskAction = 'rerun' | 'append' | 'cancel' | { stopRunId: string }

/** 展示任务输入、运行轨迹与当前角色可执行的操作。 */
export function TaskDetails({
  taskId,
  room,
  readOnly,
  onChanged,
}: {
  taskId: string
  room: BotConversation
  readOnly: boolean
  onChanged: () => void
}) {
  const [extraInput, setExtraInput] = useState('')
  const [handoffOpen, setHandoffOpen] = useState(false)
  const handoffOpener = useRef<HTMLButtonElement>(null)
  const client = useQueryClient()
  const query = useQuery(botTaskOptions(taskId))
  const task = query.data?.data
  const action = useMutation({
    mutationFn: async (next: TaskAction) => {
      if (!task) throw new Error('任务尚未加载')
      const options = { idempotencyKey: createIdempotencyKey() }
      const body = { version: task.version }
      if (next === 'append') {
        await apiClient.appendBotTask(task.id, { ...body, content: extraInput.trim() }, options)
      } else if (next === 'rerun') {
        await apiClient.rerunBotTask(task.id, body, options)
      } else if (next === 'cancel') {
        await apiClient.cancelBotTask(task.id, body, options)
      } else {
        await apiClient.stopBotRun(next.stopRunId, options)
      }
    },
    onSuccess: (_, next) => {
      if (next === 'append') setExtraInput('')
      void client.invalidateQueries({ queryKey: taskQueries })
      onChanged()
    },
  })
  if (query.isPending) return <DelayedPageSkeleton />
  if (query.isError) return <PageError title="任务加载失败" error={query.error} onRetry={() => void query.refetch()} />
  if (!task) return null
  const active = task.runs.some(({ status }) => status === 'queued' || status === 'running')
  const owner = room.members.find(({ id }) => id === task.businessOwnerId)?.name ?? '已离开会话'
  const executor = room.members.find(({ id }) => id === task.executorBotId)?.name ?? '已离开会话'
  const receivers = room.members.filter((member) => member.kind === 'bot' && member.id !== task.executorBotId)
  const closeHandoff = () => {
    setHandoffOpen(false)
    requestAnimationFrame(() => handoffOpener.current?.focus())
  }
  return (
    <>
      <div className="task-title">{task.title}</div>
      <dl className="work-properties">
        <div>
          <dt>状态</dt>
          <dd>{taskStatusLabels[task.status]}</dd>
        </div>
        <div>
          <dt>业务负责人</dt>
          <dd>{owner}</dd>
        </div>
        <div>
          <dt>执行者</dt>
          <dd>{executor}</dd>
        </div>
        <div>
          <dt>验收条件</dt>
          <dd className="whitespace-pre-wrap wrap-break-word">{task.acceptanceCriteria}</dd>
        </div>
        {task.waitReason && (
          <div>
            <dt>等待原因</dt>
            <dd>{waitLabels[task.waitReason]}</dd>
          </div>
        )}
      </dl>
      {task.inputs.some(({ inputVersion }) => inputVersion > 1) && (
        <section>
          <h3 className="task-section-title">补充要求</h3>
          <ol className="task-timeline">
            {task.inputs
              .filter(({ inputVersion }) => inputVersion > 1)
              .map(({ id, content, createdAt }) => (
                <li key={id}>
                  <time dateTime={createdAt}>{formatDateTime(createdAt)}</time>
                  <p>{content}</p>
                </li>
              ))}
          </ol>
        </section>
      )}
      {!readOnly && task.status === 'waiting' && !active && (
        <form
          className="task-actions"
          onSubmit={(event) => {
            event.preventDefault()
            if (extraInput.trim()) action.mutate('append')
          }}
        >
          <Textarea
            aria-label="补充任务要求"
            maxLength={16000}
            value={extraInput}
            onChange={(event) => setExtraInput(event.target.value)}
          />
          <Button type="submit" variant="outline" disabled={!extraInput.trim() || action.isPending}>
            保存补充
          </Button>
          <Button type="button" variant="outline" disabled={action.isPending} onClick={() => action.mutate('rerun')}>
            重新运行
          </Button>
        </form>
      )}
      {!readOnly && task.status !== 'cancelled' && task.status !== 'completed' && (
        <Button type="button" variant="outline" disabled={action.isPending} onClick={() => action.mutate('cancel')}>
          取消任务
        </Button>
      )}
      {action.isError && (
        <p role="alert" className="field-error">
          {describeRequestError(action.error).description}
        </p>
      )}
      {!readOnly && receivers.length > 0 && ['pending', 'waiting', 'in_progress'].includes(task.status) && (
        <Button ref={handoffOpener} type="button" variant="outline" onClick={() => setHandoffOpen(true)}>
          转交任务
        </Button>
      )}
      {handoffOpen && (
        <HandoffTaskDialog
          task={task}
          members={receivers}
          onClose={closeHandoff}
          onChanged={() => {
            closeHandoff()
            void client.invalidateQueries({ queryKey: taskQueries })
            onChanged()
          }}
        />
      )}
      {task.handoffs.length > 0 && (
        <section>
          <h3 className="task-section-title">交接记录</h3>
          <ol className="task-timeline">
            {task.handoffs.map((entry) => {
              const memberName = (id: string) =>
                room.members.find((member) => member.id === id)?.name ?? '已离开会话的智能体'
              return (
                <li key={entry.id}>
                  <strong>
                    {memberName(entry.fromBotId)} → {memberName(entry.toBotId)}
                  </strong>
                  <time dateTime={entry.createdAt}>{formatDateTime(entry.createdAt)}</time>
                  <p>{entry.reason}</p>
                  <p>{entry.summary}</p>
                  {entry.unfinished && <p>{entry.unfinished}</p>}
                </li>
              )
            })}
          </ol>
        </section>
      )}
      <WorkTagEditor
        tags={task.tags}
        teamId={room.teamId}
        target={{ targetKind: 'task', targetId: task.id }}
        readOnly={readOnly}
        onChanged={() => void client.invalidateQueries({ queryKey: taskQueries })}
      />
      <TaskResults
        task={task}
        readOnly={readOnly}
        onReviewed={() => {
          void client.invalidateQueries({ queryKey: taskQueries })
          onChanged()
        }}
      />
      <h3 className="task-section-title">运行轨迹</h3>
      {task.runs.length === 0 && <p className="small muted">暂无运行记录</p>}
      {task.runs.map((run) => (
        <TaskRun
          key={run.id}
          run={run}
          trace={task.trace.filter(({ runId }) => runId === run.id)}
          canStop={
            !readOnly &&
            !run.stopRequested &&
            !action.isPending &&
            (run.status === 'queued' || run.status === 'running')
          }
          stop={() => action.mutate({ stopRunId: run.id })}
        />
      ))}
    </>
  )
}

function TaskRun({
  run,
  trace,
  canStop,
  stop,
}: {
  run: BotTaskDetail['runs'][number]
  trace: BotTaskDetail['trace']
  canStop: boolean
  stop: () => void
}) {
  return (
    <article className="tool-result-card">
      <div className="row">
        <strong>{run.stopRequested && run.status === 'running' ? '正在停止' : runLabels[run.status]}</strong>
        <span className="spacer" />
        <time dateTime={run.createdAt}>{formatDateTime(run.createdAt)}</time>
      </div>
      {run.modelId && (
        <p className="small muted">
          {run.modelId} · {run.turns} 轮
        </p>
      )}
      {run.failureMessage && <p>{run.failureMessage}</p>}
      {trace.length > 0 && (
        <details>
          <summary>工具与 API 调用 ({trace.length})</summary>
          <ul>
            {trace.map(({ id, summary, kind, state }) => (
              <li key={id}>
                {summary ?? kind} · {state}
              </li>
            ))}
          </ul>
        </details>
      )}
      {canStop && (
        <Button type="button" variant="outline" onClick={stop}>
          停止运行
        </Button>
      )}
    </article>
  )
}
