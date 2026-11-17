import { useState } from 'react'
import { createIdempotencyKey } from '@dev-ops/api-client'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useLocation } from 'react-router'
import { ChevronLeft } from 'lucide-react'
import { apiClient } from '@/shared/api/client'
import { describeRequestError } from '@/shared/api/errors'
import { formatDateTime } from '@/shared/lib/format'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/shared/ui/controls/alert-dialog'
import { Badge } from '@/shared/ui/controls/badge'
import { Button } from '@/shared/ui/controls/button'
import { DelayedPageSkeleton } from '@/shared/ui/page-skeleton'
import { EmptyState, PageError } from '@/shared/ui/page-state'
import { useToast } from '@/shared/ui/toast'
import { botDetailQueryOptions, botQueryKey, botRunsQueryOptions, type BotRunView } from '../api/queries'
import { BotForm } from './bot-form'
import { BotStatus } from './bot-status'

const runLabels = {
  queued: '排队中',
  running: '执行中',
  succeeded: '已完成',
  failed: '失败',
  stopped: '已停止',
} satisfies Record<BotRunView['status'], string>

function BotRuns({ botId }: { botId: string }) {
  const [cursor, setCursor] = useState<string>()
  const query = useQuery(botRunsQueryOptions(botId, cursor))
  const records = query.data?.data
  return (
    <section className="space-y-3" aria-labelledby="bot-runs">
      <h2 id="bot-runs" className="font-semibold">
        运行记录
      </h2>
      {query.isPending ? <DelayedPageSkeleton /> : null}
      {query.isError && <PageError title="运行记录加载失败" error={query.error} onRetry={() => void query.refetch()} />}
      {records?.items.length === 0 && <p className="quiet">当前可见的会话里暂无运行记录。</p>}
      {records && records.items.length > 0 && (
        <ul className="divide-y divide-border" aria-busy={query.isFetching}>
          {records.items.map((run) => (
            <li key={run.id} className="py-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={run.status === 'failed' ? 'destructive' : 'outline'}>{runLabels[run.status]}</Badge>
                <span className="small quiet">{formatDateTime(run.createdAt)}</span>
                <span className="small quiet">{run.turns} 轮</span>
              </div>
              {run.failureMessage && <p className="mt-2 break-words">{run.failureMessage}</p>}
            </li>
          ))}
        </ul>
      )}
      {(cursor || records?.nextCursor) && (
        <div className="flex gap-2">
          {cursor && (
            <Button variant="outline" type="button" onClick={() => setCursor(undefined)}>
              回到第一页
            </Button>
          )}
          {records?.nextCursor && (
            <Button
              variant="outline"
              type="button"
              disabled={query.isFetching}
              onClick={() => setCursor(records.nextCursor ?? undefined)}
            >
              下一页
            </Button>
          )}
        </div>
      )}
    </section>
  )
}

interface BotDetailProps {
  botId: string
  teamId: string
  userId: string
  canEdit: boolean
}

/** 展示 Bot 的配置、模型状态和当前会话权限下的运行记录。 */
export function BotDetail({ botId, teamId, userId, canEdit }: BotDetailProps) {
  const { search } = useLocation()
  const query = useQuery(botDetailQueryOptions(botId))
  const bot = query.data?.data
  const [editing, setEditing] = useState(false)
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const toggle = useMutation({
    mutationFn: () => {
      if (!bot) throw new Error('Bot 配置尚未加载')
      return apiClient.setBotEnabled(
        bot.id,
        bot.status === 'disabled',
        { configVersion: bot.configVersion },
        { idempotencyKey: createIdempotencyKey() },
      )
    },
    onSuccess: async ({ data }) => {
      await queryClient.invalidateQueries({ queryKey: botQueryKey })
      showToast(data.status === 'enabled' ? 'Bot 已启用' : 'Bot 已停用', 'success')
    },
  })
  const back = (
    <Link
      className="flex w-fit items-center gap-1 text-sm text-primary"
      to={{ pathname: '/capabilities/bots', search }}
    >
      <ChevronLeft className="size-4" aria-hidden="true" />
      返回智能体
    </Link>
  )
  if (query.isPending) return <DelayedPageSkeleton />
  if (!bot)
    return (
      <>
        {back}
        <PageError title="Bot 配置加载失败" error={query.error} onRetry={() => void query.refetch()} />
      </>
    )
  if (bot.teamId !== teamId)
    return (
      <>
        {back}
        <EmptyState title="该 Bot 不在当前团队" description="切换到 Bot 所属团队后查看。" />
      </>
    )

  return (
    <>
      <header className="page-head flex-wrap gap-3">
        <div className="min-w-0 space-y-2">
          {back}
          <h1 className="break-words">{bot.name}</h1>
        </div>
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" disabled={toggle.isPending} onClick={() => setEditing(true)}>
              编辑配置
            </Button>
            {bot.status === 'enabled' ? (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button type="button" variant="outline" disabled={toggle.isPending}>
                    停用 Bot
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>停用 {bot.name}？</AlertDialogTitle>
                    <AlertDialogDescription>
                      已排队的运行会取消，正在执行的运行会收到停止请求。未完成任务会标为受阻，历史记录会保留。
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>取消</AlertDialogCancel>
                    <AlertDialogAction
                      className="bg-destructive text-destructive-foreground"
                      onClick={() => toggle.mutate()}
                    >
                      确认停用
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            ) : (
              <Button type="button" variant="outline" disabled={toggle.isPending} onClick={() => toggle.mutate()}>
                启用 Bot
              </Button>
            )}
          </div>
        )}
      </header>
      <div className="catalog space-y-6">
        {toggle.error && (
          <p role="alert" className="text-sm text-destructive">
            {describeRequestError(toggle.error).description}
          </p>
        )}
        <section className="space-y-3" aria-labelledby="bot-config">
          <h2 id="bot-config" className="font-semibold">
            配置
          </h2>
          <dl className="grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="small quiet">运行状态</dt>
              <dd className="mt-1">
                <BotStatus value={bot.availability} />
              </dd>
            </div>
            <div>
              <dt className="small quiet">负责人</dt>
              <dd className="break-words">{bot.ownerName ?? '未找到成员'}</dd>
            </div>
            <div>
              <dt className="small quiet">模型连接</dt>
              <dd className="break-words">{bot.connectionName ?? '未绑定'}</dd>
            </div>
            <div>
              <dt className="small quiet">模型</dt>
              <dd className="break-all">{bot.modelId ?? '未绑定'}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="small quiet">职责</dt>
              <dd className="whitespace-pre-wrap wrap-break-word">{bot.responsibility}</dd>
            </div>
            {bot.instructions && (
              <div className="sm:col-span-2">
                <dt className="small quiet">指令</dt>
                <dd className="whitespace-pre-wrap wrap-break-word">{bot.instructions}</dd>
              </div>
            )}
          </dl>
        </section>
        <BotRuns key={bot.id} botId={bot.id} />
      </div>
      {editing && <BotForm teamId={teamId} defaultOwnerId={userId} bot={bot} onClose={() => setEditing(false)} />}
    </>
  )
}
