import { useState } from 'react'
import { createIdempotencyKey } from '@dev-ops/api-client'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { botConnectionsOptions, connectionQueryKey, type BotConnection } from '@/features/bots/api/connections'
import { botQueryKey } from '@/features/bots/api/queries'
import { BotConnectionForm } from '@/features/bots/ui/bot-connection-form'
import { apiClient } from '@/shared/api/client'
import { describeRequestError } from '@/shared/api/errors'
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
import { DelayedPageSkeleton } from '@/shared/ui/page-skeleton'
import { PageError } from '@/shared/ui/page-state'
import { Tag } from '@/shared/ui/tag'
import { useToast } from '@/shared/ui/toast'

const labels = { active: '可用', disabled: '已停用', login_failed: '需重新登录' }
const reasons: Record<string, string> = {
  manual: '手动停用',
  login_user_demoted: '登录人已失去团队管理员权限',
  auth_expired: '订阅授权已失效',
}

/**
 * 展示团队模型连接，并按权限提供创建、启用与停用操作。
 * @param props.teamId 当前团队标识。
 * @param props.canManage 当前用户是否可以管理模型连接。
 * @returns 模型连接列表和创建弹窗；操作失败时保留列表并展示错误反馈。
 */
export function BotModelConnections({ teamId, canManage }: { teamId: string; canManage: boolean }) {
  const [createOpen, setCreateOpen] = useState(false)
  const query = useQuery(botConnectionsOptions(teamId))
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const update = useMutation({
    mutationFn: (connection: BotConnection) =>
      apiClient.setBotConnectionEnabled(
        connection.id,
        connection.status !== 'active',
        { version: connection.version },
        { idempotencyKey: createIdempotencyKey() },
      ),
    onSuccess: async ({ data }) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: connectionQueryKey }),
        queryClient.invalidateQueries({ queryKey: botQueryKey }),
      ])
      showToast(data.status === 'active' ? '模型连接已启用' : '模型连接已停用', 'success')
    },
    onError: (error) => showToast(describeRequestError(error).description, 'error'),
  })
  const items = query.data?.data ?? []
  return (
    <>
      <section aria-label="模型配置" className="settings-list-width grid gap-3">
        <div className="section-heading settings-heading">
          <h2>模型连接</h2>
          {canManage && (
            <Button type="button" className="max-md:min-h-11" onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" aria-hidden="true" />
              添加模型连接
            </Button>
          )}
        </div>
        {query.isPending && <DelayedPageSkeleton />}
        {query.isError && (
          <PageError title="模型连接加载失败" error={query.error} onRetry={() => void query.refetch()} />
        )}
        {query.isSuccess && items.length === 0 && (
          <div className="settings-inline-empty">
            <strong>还没有模型连接</strong>
            <p>{canManage ? '添加 API Key 或订阅连接后即可为智能体绑定模型。' : '可用模型连接由团队管理员配置。'}</p>
          </div>
        )}
        {items.length > 0 && (
          <ul className="divide-y border-y">
            {items.map((connection) => (
              <li className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3" key={connection.id}>
                <div className="min-w-0 flex-1 basis-32">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-semibold wrap-anywhere">{connection.name}</h3>
                    <Tag variant={connection.status === 'active' ? 'green' : 'neutral'}>
                      {labels[connection.status]}
                    </Tag>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground wrap-anywhere">
                    {connection.authType === 'oauth' ? '订阅登录' : 'API Key'} · {connection.providerId}
                    {connection.loginUserName && ` · ${connection.loginUserName}`}
                  </p>
                  {connection.disabledReason && reasons[connection.disabledReason] && (
                    <p className="mt-1 text-xs text-muted-foreground">{reasons[connection.disabledReason]}</p>
                  )}
                </div>
                {canManage && connection.status === 'active' && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button type="button" variant="ghost" className="max-md:min-h-11" disabled={update.isPending}>
                        停用连接
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>停用 {connection.name}？</AlertDialogTitle>
                        <AlertDialogDescription>绑定这条连接的智能体将停止运行，历史记录保留。</AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>取消</AlertDialogCancel>
                        <AlertDialogAction onClick={() => update.mutate(connection)}>确认停用</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
                {canManage && connection.status === 'disabled' && connection.disabledReason === 'manual' && (
                  <Button
                    type="button"
                    variant="outline"
                    className="max-md:min-h-11"
                    disabled={update.isPending}
                    onClick={() => update.mutate(connection)}
                  >
                    启用连接
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      {createOpen && <BotConnectionForm teamId={teamId} onClose={() => setCreateOpen(false)} />}
    </>
  )
}
