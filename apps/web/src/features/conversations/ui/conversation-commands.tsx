import { useMutation, useQuery, useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { createIdempotencyKey } from '@dev-ops/api-client'
import { useNavigate } from 'react-router'
import { apiClient } from '@/shared/api/client'
import { describeRequestError } from '@/shared/api/errors'
import { Button } from '@/shared/ui/controls/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/shared/ui/controls/dialog'
import { conversationOptions, conversationsQueryKey, messagesOptions, type BotConversation } from '../api/queries'
import { ConversationRuntimeSettings } from './conversation-runtime-settings'

export const commandCandidates = [
  ['model', '选择模型'],
  ['thinking', '调整思考等级'],
  ['compact', '压缩上下文'],
  ['new', '开始新的模型会话'],
  ['fork', '从消息分叉'],
  ['tree', '切换消息分支'],
  ['copy', '复制最近回复'],
  ['session', '本会话用量'],
].map(([token = '', name = '']) => ({ id: `command:${token}`, kind: 'command' as const, token, name }))

/**
 * 执行输入区命令，复用会话设置、压缩、分叉及分支接口。
 * @param props 会话、所选命令、关闭回调与运行状态。
 * @returns 命令弹窗；失败保留当前选择并显示可重试错误。
 */
export function ConversationCommands({
  room,
  command,
  onClose,
  busy,
}: {
  room: BotConversation
  command?: string
  onClose: () => void
  busy: boolean
}) {
  const navigate = useNavigate()
  const client = useQueryClient()
  const needsMessages = command === 'copy' || command === 'fork' || command === 'tree'
  const messages = useInfiniteQuery({ ...messagesOptions(room.id), enabled: needsMessages })
  const usage = useQuery({
    queryKey: ['bot-conversation-usage', room.id],
    queryFn: () => apiClient.getBotConversationUsage(room.id),
    enabled: command === 'session',
  })
  const botId = room.leaderBotId ?? room.members.find(({ kind }) => kind === 'bot')?.id
  const items =
    messages.data?.pages
      .slice()
      .reverse()
      .flatMap(({ data }) => data.items) ?? []
  const action = useMutation({
    async mutationFn(input: { command: string; messageId?: string; direction?: 'previous' | 'next' }) {
      const options = { idempotencyKey: createIdempotencyKey() }
      if (input.command === 'copy') {
        const latest = [...items].reverse().find(({ speakerKind }) => speakerKind === 'bot')
        if (!latest) throw new Error('会话还没有可复制的回复')
        await navigator.clipboard.writeText(
          latest.body.blocks.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('\n'),
        )
      } else if (input.command === 'fork' && input.messageId) {
        const result = await apiClient.forkBotConversation(room.id, { messageId: input.messageId }, options)
        void navigate(`/collaboration/${result.data.id}`)
      } else if (input.command === 'tree' && input.messageId && input.direction) {
        await apiClient.switchBotConversationBranch(
          room.id,
          { messageId: input.messageId, direction: input.direction },
          options,
        )
      } else if (botId && input.command === 'compact') await apiClient.compactBotConversation(room.id, botId, options)
      else if (botId && input.command === 'new') {
        const result = await apiClient.createBotConversation(
          room.teamId,
          room.kind === 'direct'
            ? { kind: 'direct', botId, newSession: true }
            : {
                kind: 'group',
                name: room.name,
                leaderBotId: botId,
                botIds: room.members.filter(({ kind }) => kind === 'bot').map(({ id }) => id),
                memberUserIds: room.members.filter(({ kind }) => kind === 'user').map(({ id }) => id),
                responsibility: room.responsibility,
                instructions: room.instructions,
              },
          options,
        )
        void navigate(`/collaboration/${result.data.id}`)
      }
    },
    async onSuccess() {
      await Promise.all([
        client.invalidateQueries({ queryKey: conversationOptions(room.id).queryKey }),
        client.invalidateQueries({ queryKey: messagesOptions(room.id).queryKey }),
        client.invalidateQueries({ queryKey: conversationsQueryKey }),
      ])
      onClose()
    },
  })
  return (
    <Dialog
      open={!!command}
      onOpenChange={(open) => {
        if (!open && !action.isPending) onClose()
      }}
    >
      <DialogContent
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          onClose()
        }}
      >
        <DialogHeader>
          <DialogTitle>/{command}</DialogTitle>
          <DialogDescription>{commandCandidates.find(({ token }) => token === command)?.name}</DialogDescription>
        </DialogHeader>
        {command === 'session' && usage.isPending && <p role="status">正在加载会话用量…</p>}
        {command === 'session' && usage.isError && (
          <Button onClick={() => void usage.refetch()}>用量加载失败，重试</Button>
        )}
        {command === 'session' && usage.isSuccess && (
          <p>
            输入 {usage.data?.data.inputTokens ?? '—'} tokens · 输出 {usage.data?.data.outputTokens ?? '—'} tokens ·
            费用 {typeof usage.data?.data.costUsd !== 'number' ? '未知' : `$${usage.data.data.costUsd.toFixed(4)}`}
          </p>
        )}
        {(command === 'model' || command === 'thinking') && botId && (
          <ConversationRuntimeSettings room={room} botId={botId} name={room.name} readOnly={false} busy={busy} />
        )}
        {command === 'copy' && messages.isSuccess && !items.some(({ speakerKind }) => speakerKind === 'bot') && (
          <p>暂无可复制的回复。</p>
        )}
        {(command === 'new' || command === 'compact' || command === 'copy') && (
          <>
            {command === 'new' && <p>创建一个独立的新会话，原会话及消息历史会保留。</p>}
            <Button
              disabled={
                action.isPending ||
                (command !== 'copy' && busy) ||
                (needsMessages && messages.isPending) ||
                (command === 'copy' && !items.some(({ speakerKind }) => speakerKind === 'bot'))
              }
              onClick={() => {
                if (command) action.mutate({ command })
              }}
            >
              确认{commandCandidates.find(({ token }) => token === command)?.name}
            </Button>
          </>
        )}
        {needsMessages && messages.isPending && <p role="status">正在加载会话消息…</p>}
        {(command === 'fork' || command === 'tree') && (
          <div className="grid gap-2 overflow-auto">
            {messages.hasNextPage && (
              <Button disabled={messages.isFetchingNextPage} onClick={() => void messages.fetchNextPage()}>
                加载更早的消息
              </Button>
            )}
            {items
              .filter((item) => command === 'fork' || item.branchSiblings)
              .map((item) => (
                <div key={item.id} className="row flex-wrap gap-2">
                  <span className="min-w-0 truncate">
                    {item.body.blocks
                      .flatMap((block) => (block.type === 'text' ? [block.text] : []))
                      .join(' ')
                      .slice(0, 100)}
                  </span>
                  {command === 'fork' ? (
                    <Button
                      size="sm"
                      disabled={action.isPending}
                      onClick={() => action.mutate({ command, messageId: item.id })}
                    >
                      从这里分叉
                    </Button>
                  ) : (
                    <>
                      <Button
                        size="sm"
                        disabled={busy || action.isPending || (item.branchSiblings?.index ?? 1) <= 1}
                        onClick={() => action.mutate({ command, messageId: item.id, direction: 'previous' })}
                      >
                        上一分支
                      </Button>
                      <Button
                        size="sm"
                        disabled={
                          busy ||
                          action.isPending ||
                          (item.branchSiblings?.index ?? 1) >= (item.branchSiblings?.total ?? 1)
                        }
                        onClick={() => action.mutate({ command, messageId: item.id, direction: 'next' })}
                      >
                        下一分支
                      </Button>
                    </>
                  )}
                </div>
              ))}
            {!messages.isPending &&
              !messages.isError &&
              !items.some((item) => command === 'fork' || item.branchSiblings) && <p>暂无可用消息分支。</p>}
          </div>
        )}
        {needsMessages && messages.isError && (
          <Button onClick={() => void messages.refetch()}>消息加载失败，重试</Button>
        )}
        {action.isError && (
          <p role="alert" className="field-error">
            {describeRequestError(action.error).description}
          </p>
        )}
      </DialogContent>
    </Dialog>
  )
}
