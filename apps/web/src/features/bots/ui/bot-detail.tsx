import { useEffect, useRef, useState } from 'react'
import { createIdempotencyKey } from '@dev-ops/api-client'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Clock, Cpu, Layers, Pencil, Shield, SquareTerminal, User, X } from 'lucide-react'
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
import { Button } from '@/shared/ui/controls/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/controls/tabs'
import { DelayedPageSkeleton } from '@/shared/ui/page-skeleton'
import { EmptyState, PageError } from '@/shared/ui/page-state'
import { useToast } from '@/shared/ui/toast'
import { skillListQueryOptions } from '@/features/knowledge/api/queries'
import { botDetailQueryOptions, botQueryKey, botRunsQueryOptions, type BotRunView } from '../api/queries'
import { BotAvatar } from './bot-avatar'
import { BotForm } from './bot-form'
import { BotModelForm } from './bot-model-form'
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
    <div className="run-list">
      {query.isPending && <DelayedPageSkeleton />}
      {query.isError && <PageError title="运行记录加载失败" error={query.error} onRetry={() => void query.refetch()} />}
      {records?.items.length === 0 && (
        <div className="empty">
          <h3>还没有运行记录</h3>
        </div>
      )}
      {records?.items.map((run) => (
        <article key={run.id}>
          <div className="row">
            {run.status === 'succeeded' ? (
              <Check className="icon fill-none stroke-current stroke-2" aria-hidden="true" />
            ) : (
              <Clock className="icon fill-none stroke-current stroke-2" aria-hidden="true" />
            )}
            <strong>{runLabels[run.status]}</strong>
          </div>
          <p>
            {formatDateTime(run.createdAt)} · {run.turns} 轮
          </p>
          {run.failureMessage && <p className="break-words">{run.failureMessage}</p>}
        </article>
      ))}
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
    </div>
  )
}

interface BotDetailProps {
  botId: string
  teamId: string
  userId: string
  canEdit: boolean
  canBindModel: boolean
  onClose: () => void
}

/** 沿用原型右侧详情栏，保留配置和当前会话权限下的运行记录。 */
export function BotDetail({ botId, teamId, userId, canEdit, canBindModel, onClose }: BotDetailProps) {
  const query = useQuery(botDetailQueryOptions(botId))
  const bot = query.data?.data
  const [editing, setEditing] = useState(false)
  const [bindingModel, setBindingModel] = useState(false)
  const closeRef = useRef<HTMLButtonElement>(null)
  const detailRef = useRef<HTMLElement>(null)
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const skillQuery = useQuery({
    ...skillListQueryOptions(teamId, { pageSize: 100 }),
    enabled: Boolean(bot?.skillIds.length),
  })
  const enabledSkills = skillQuery.data?.data.items.filter((skill) => bot?.skillIds.includes(skill.id)) ?? []
  useEffect(() => {
    const opener = document.activeElement
    closeRef.current?.focus()
    return () => {
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus()
    }
  }, [])

  const toggle = useMutation({
    mutationFn: () => {
      if (!bot) throw new Error('智能体配置尚未加载')
      return apiClient.setBotEnabled(
        bot.id,
        bot.status === 'disabled',
        { configVersion: bot.configVersion },
        { idempotencyKey: createIdempotencyKey() },
      )
    },
    onSuccess: async ({ data }) => {
      await queryClient.invalidateQueries({ queryKey: botQueryKey })
      showToast(data.status === 'enabled' ? '智能体已启用' : '智能体已停用', 'success')
    },
  })

  return (
    <aside
      ref={detailRef}
      className="details agent-details h-dvh min-h-0 bg-background"
      aria-label="智能体详情"
      onKeyDown={(event) => {
        if (event.defaultPrevented || !detailRef.current?.contains(event.target instanceof Node ? event.target : null))
          return
        if (event.key === 'Escape') {
          event.preventDefault()
          onClose()
        }
      }}
    >
      <div className="detail-top h-16">
        <h2>智能体详情</h2>
        <span className="spacer" />
        <Button
          ref={closeRef}
          type="button"
          className="icon-btn"
          variant="ghost"
          size="icon-sm"
          aria-label="关闭智能体详情"
          onClick={onClose}
        >
          <X aria-hidden="true" />
        </Button>
      </div>
      {query.isPending && (
        <div className="detail-scroll">
          <DelayedPageSkeleton />
        </div>
      )}
      {!query.isPending && !bot && (
        <div className="detail-scroll">
          <PageError title="智能体配置加载失败" error={query.error} onRetry={() => void query.refetch()} />
        </div>
      )}
      {bot && bot.teamId !== teamId && (
        <div className="detail-scroll">
          <EmptyState title="该智能体不在当前团队" description="切换到智能体所属团队后查看。" />
        </div>
      )}
      {bot?.teamId === teamId && (
        <>
          <div className="agent-profile">
            <BotAvatar avatarKey={bot.avatarKey} botId={bot.id} large />
            <div className="min-w-0">
              <h2 className="wrap-break-word">{bot.name}</h2>
              <p className="wrap-break-word">{bot.responsibility}</p>
            </div>
            <span className="spacer" />
            <BotStatus value={bot.availability} />
          </div>
          <Tabs defaultValue="config" className="min-h-0 flex-1 gap-0">
            <TabsList
              className="agent-detail-tabs tabs w-auto gap-6 rounded-none bg-transparent p-0"
              aria-label="智能体详情内容"
            >
              <TabsTrigger value="config" variant="underline">
                配置
              </TabsTrigger>
              <TabsTrigger value="runs" variant="underline">
                运行记录
              </TabsTrigger>
            </TabsList>
            <TabsContent value="config" className="detail-scroll">
              {bot.instructions && (
                <p className="agent-purpose whitespace-pre-wrap wrap-break-word">{bot.instructions}</p>
              )}
              <dl className="properties">
                <dt>
                  <User className="icon fill-none stroke-current stroke-2" aria-hidden="true" />
                  负责人
                </dt>
                <dd>{bot.ownerName ?? '未找到成员'}</dd>
                <dt>
                  <SquareTerminal className="icon fill-none stroke-current stroke-2" aria-hidden="true" />
                  运行环境
                </dt>
                <dd>团队执行器</dd>
                <dt>
                  <Cpu className="icon fill-none stroke-current stroke-2" aria-hidden="true" />
                  模型
                </dt>
                <dd className="wrap-break-word">
                  {bot.modelId ?? '未绑定模型'}
                  {bot.connectionName && <span className="small quiet block">{bot.connectionName}</span>}
                  {canBindModel && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="mt-2"
                      onClick={() => setBindingModel(true)}
                    >
                      绑定模型
                    </Button>
                  )}
                </dd>
                <dt>
                  <Shield className="icon fill-none stroke-current stroke-2" aria-hidden="true" />
                  使用范围
                </dt>
                <dd>独立 Bot</dd>
              </dl>
              <div className="agent-section">
                <h3>
                  可用 Skills <span className="counter">{bot.skillIds.length}</span>
                </h3>
                <div className="agent-skills">
                  {bot.skillIds.length === 0 && <p className="quiet small">尚未配置技能</p>}
                  {skillQuery.isFetching && bot.skillIds.length > 0 && <p className="quiet small">正在加载技能…</p>}
                  {skillQuery.isError && (
                    <Button variant="outline" type="button" onClick={() => void skillQuery.refetch()}>
                      重试加载技能
                    </Button>
                  )}
                  {enabledSkills.map((skill) => (
                    <div key={skill.id} className="row py-2 small">
                      <Layers className="icon fill-none stroke-current stroke-2" aria-hidden="true" />
                      <span>{skill.name}</span>
                      {!skill.enabled && <span className="quiet">已停用</span>}
                    </div>
                  ))}
                </div>
              </div>
            </TabsContent>
            <TabsContent value="runs" className="detail-scroll">
              <BotRuns key={bot.id} botId={bot.id} />
            </TabsContent>
          </Tabs>
          {toggle.error && (
            <p role="alert" className="mx-5 text-sm text-destructive">
              {describeRequestError(toggle.error).description}
            </p>
          )}
          {canEdit && (
            <div className="agent-detail-actions">
              <Button
                type="button"
                className="btn"
                variant="outline"
                disabled={toggle.isPending}
                onClick={() => setEditing(true)}
              >
                <Pencil className="size-4" aria-hidden="true" />
                编辑配置
              </Button>
              {bot.status === 'enabled' ? (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button type="button" className="btn" variant="outline" disabled={toggle.isPending}>
                      停用智能体
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
                <Button
                  type="button"
                  className="btn"
                  variant="outline"
                  disabled={toggle.isPending}
                  onClick={() => toggle.mutate()}
                >
                  启用智能体
                </Button>
              )}
            </div>
          )}
          {bindingModel && <BotModelForm bot={bot} onClose={() => setBindingModel(false)} />}
          {editing && <BotForm teamId={teamId} defaultOwnerId={userId} bot={bot} onClose={() => setEditing(false)} />}
        </>
      )}
    </aside>
  )
}
