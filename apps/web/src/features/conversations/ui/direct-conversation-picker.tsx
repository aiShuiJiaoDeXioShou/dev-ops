import { useInfiniteQuery } from '@tanstack/react-query'
import { useRef } from 'react'
import { Link } from 'react-router'
import { botChoicesOptions } from '@/features/bots/api/queries'
import { Button } from '@/shared/ui/controls/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/shared/ui/controls/dialog'
import { TooltipProvider } from '@/shared/ui/controls/tooltip'
import { DelayedPageSkeleton } from '@/shared/ui/page-skeleton'
import { EmptyState, PageError } from '@/shared/ui/page-state'
import { useOpenDirectConversation } from '../api/open-direct'
import { ConversationBotOption } from './conversation-bot-option'

/**
 * 选择团队智能体后打开私聊；从技能入口打开时仅列出可执行该技能的智能体。
 * @param props 当前团队、可预填的技能，以及关闭、成功和焦点归还回调。
 * @returns 支持分页和重试的选择弹窗；提交期间禁止重复选择和关闭。
 */
export function DirectConversationPicker({
  teamId,
  skill,
  onClose,
  onOpened,
  onRestoreFocus,
}: {
  teamId: string
  skill?: { id: string; name: string }
  onClose: () => void
  onOpened?: () => void
  onRestoreFocus?: () => void
}) {
  const titleRef = useRef<HTMLHeadingElement>(null)
  const list = useInfiniteQuery(botChoicesOptions(teamId))
  const bots = list.data?.pages.flatMap(({ data }) => data.items) ?? []
  const choices = skill
    ? bots.filter((bot) => bot.availability === 'available' && bot.skillIds.includes(skill.id))
    : bots
  const openConversation = useOpenDirectConversation(teamId, skill?.id)
  const openForBot = (botId: string) => openConversation.mutate(botId, { onSuccess: onOpened })

  return (
    <Dialog open onOpenChange={(open) => !open && !openConversation.isPending && onClose()}>
      <DialogContent
        className="dialog-w-sm gap-4 p-4 sm:p-6"
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          titleRef.current?.focus()
        }}
        onCloseAutoFocus={(event) => {
          if (!onRestoreFocus) return
          event.preventDefault()
          onRestoreFocus()
        }}
      >
        <DialogHeader className="gap-1">
          <DialogTitle ref={titleRef} tabIndex={-1} className="outline-none">
            {skill ? `使用 ${skill.name}` : '新建私聊'}
          </DialogTitle>
          <DialogDescription className={skill ? undefined : 'sr-only'}>
            {skill ? '选择智能体，技能会带入聊天输入框。' : '选择智能体以打开对话。'}
          </DialogDescription>
        </DialogHeader>
        {list.isPending && <DelayedPageSkeleton />}
        {list.isError && !list.isFetchNextPageError && (
          <PageError
            title="智能体加载失败"
            error={list.error}
            retrying={list.isFetching}
            onRetry={() => void list.refetch()}
          />
        )}
        {choices.length > 0 && (
          <TooltipProvider delayDuration={250}>
            <ul role="list" aria-label="智能体列表" className="conversation-bot-options">
              {choices.map((bot) => (
                <ConversationBotOption
                  key={bot.id}
                  bot={bot}
                  disabled={openConversation.isPending}
                  onSelect={() => openForBot(bot.id)}
                />
              ))}
            </ul>
          </TooltipProvider>
        )}
        {list.isFetchNextPageError ? (
          <PageError
            title="更多智能体加载失败"
            error={list.error}
            retrying={list.isFetchingNextPage}
            onRetry={() => void list.fetchNextPage()}
          />
        ) : (
          list.hasNextPage && (
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              disabled={list.isFetchingNextPage}
              onClick={() => void list.fetchNextPage()}
            >
              {list.isFetchingNextPage ? '正在加载…' : '加载更多智能体'}
            </Button>
          )
        )}
        {list.isSuccess && !list.hasNextPage && choices.length === 0 && (
          <EmptyState
            mascot="orbit"
            title={skill ? '没有可用的智能体' : '团队还没有智能体'}
            description={skill ? '为智能体配置此技能，并确认智能体可用。' : '在能力页创建智能体后，即可开始私聊。'}
            action={
              skill && (
                <Button asChild variant="outline">
                  <Link to="/capabilities/bots">管理智能体</Link>
                </Button>
              )
            }
          />
        )}
        {openConversation.isPending && (
          <p role="status" className="small muted">
            正在打开对话…
          </p>
        )}
        {openConversation.isError && (
          <PageError
            title="打开对话失败"
            error={openConversation.error}
            onRetry={() => {
              if (openConversation.variables) openForBot(openConversation.variables)
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
