import { useState } from 'react'
import { createIdempotencyKey } from '@dev-ops/api-client'
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/shared/api/client'
import { describeRequestError } from '@/shared/api/errors'
import { Button } from '@/shared/ui/controls/button'
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
import { botMemoryKey, botMemoryOptions, type BotMemory } from '../api/memories'
import type { BotView } from '../api/queries'
import { MemoryDialog } from './memory-dialog'

/**
 * 在会话侧栏内管理指定 Bot 的可见记忆，不离开当前会话。
 * @param props 当前 Bot、写权限和是否允许新增 Bot 笔记。
 * @returns 可展开的记忆列表与内嵌增改表单；删除先确认，所有写操作仍受服务端权限校验。
 */
export function BotMemoryPanel({ bot, canWrite, isAdmin }: { bot: BotView; canWrite: boolean; isAdmin: boolean }) {
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<BotMemory | 'new'>()
  const client = useQueryClient()
  const list = useInfiniteQuery({ ...botMemoryOptions(bot.teamId, { botId: bot.id }), enabled: open })
  const memories = list.data?.pages.flatMap(({ data }) => data.items) ?? []
  const refresh = () => client.invalidateQueries({ queryKey: botMemoryKey })
  const remove = useMutation({
    mutationFn: (id: string) => apiClient.removeBotMemory(id, { idempotencyKey: createIdempotencyKey() }),
    onSuccess: refresh,
  })
  return (
    <section className="settings-section" aria-label={`${bot.name}的长期记忆`}>
      <div className="row">
        <strong>长期记忆</strong>
        <span className="spacer" />
        <Button
          type="button"
          variant="ghost"
          aria-expanded={open}
          disabled={Boolean(editing) || remove.isPending}
          onClick={() => setOpen(!open)}
        >
          {open ? '收起记忆' : '管理记忆'}
        </Button>
      </div>
      {open && (
        <div className="grid gap-3 pt-3">
          {editing ? (
            <MemoryDialog
              inline
              teamId={bot.teamId}
              bots={[bot]}
              botId={bot.id}
              item={editing === 'new' ? undefined : editing}
              allowBotScope={isAdmin}
              onClose={() => setEditing(undefined)}
              onSaved={async () => {
                await refresh()
                setEditing(undefined)
              }}
            />
          ) : (
            <>
              {canWrite && (
                <Button type="button" variant="outline" disabled={remove.isPending} onClick={() => setEditing('new')}>
                  新增记忆
                </Button>
              )}
              {list.isPending && <p role="status">正在加载记忆…</p>}
              {list.isError && (
                <div>
                  <p className="field-error" role="alert">
                    {describeRequestError(list.error).description}
                  </p>
                  <Button type="button" variant="outline" onClick={() => void list.refetch()}>
                    重试加载记忆
                  </Button>
                </div>
              )}
              {list.isSuccess && !memories.length && (
                <p>{canWrite ? '还没有记忆，可以在这里新增，也可以在对话中让 Bot 记住。' : '还没有可查看的记忆。'}</p>
              )}
              {memories.map((memory) => (
                <article className="border-b border-border pb-3" key={memory.id}>
                  <div className="row flex-wrap">
                    <span className="badge">{memory.scope === 'user' ? '用户画像' : 'Bot 笔记'}</span>
                    {memory.essential && <span className="badge">常驻</span>}
                  </div>
                  <p className="whitespace-pre-wrap">{memory.content}</p>
                  {memory.scope === 'user' && memory.sourceUserName && (
                    <p className="small quiet">{memory.sourceUserName}</p>
                  )}
                  {canWrite && (
                    <div className="row pt-2">
                      {memory.canEdit && (
                        <Button
                          type="button"
                          variant="ghost"
                          disabled={remove.isPending}
                          onClick={() => setEditing(memory)}
                        >
                          编辑记忆
                        </Button>
                      )}
                      {memory.canRemove && (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button type="button" variant="ghost" disabled={remove.isPending}>
                              删除记忆
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>删除这条记忆？</AlertDialogTitle>
                              <AlertDialogDescription>删除后，新的运行将不再使用这条记忆。</AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>取消</AlertDialogCancel>
                              <AlertDialogAction onClick={() => remove.mutate(memory.id)}>确认删除</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      )}
                    </div>
                  )}
                </article>
              ))}
              {list.hasNextPage && (
                <Button
                  type="button"
                  variant="ghost"
                  disabled={list.isFetchingNextPage}
                  onClick={() => void list.fetchNextPage()}
                >
                  {list.isFetchingNextPage ? '正在加载…' : '加载更多记忆'}
                </Button>
              )}
              {remove.isError && (
                <p className="field-error" role="alert">
                  {describeRequestError(remove.error).description}
                </p>
              )}
            </>
          )}
        </div>
      )}
    </section>
  )
}
