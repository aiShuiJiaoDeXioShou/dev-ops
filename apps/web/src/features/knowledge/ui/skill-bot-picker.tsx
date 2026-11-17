import { useInfiniteQuery } from '@tanstack/react-query'
import { ArrowRight } from 'lucide-react'
import { Link } from 'react-router'
import { botChoicesOptions } from '@/features/bots/api/queries'
import { BotAvatar } from '@/features/bots/ui/bot-avatar'
import { useOpenDirectConversation } from '@/features/conversations/api/open-direct'
import { Button } from '@/shared/ui/controls/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/shared/ui/controls/dialog'
import { DelayedPageSkeleton } from '@/shared/ui/page-skeleton'
import { EmptyState, PageError } from '@/shared/ui/page-state'
import type { SkillDetail } from '../model/types'

/**
 * 复用原型的智能体选择器，只列出已配置当前技能且可用的智能体。
 * @param props 当前团队、要引用的技能及关闭回调。
 * @returns 选择智能体的弹窗，成功后进入私聊并预填引用。
 */
export function SkillBotPicker({
  teamId,
  skill,
  onClose,
}: {
  teamId: string
  skill: SkillDetail
  onClose: () => void
}) {
  const list = useInfiniteQuery(botChoicesOptions(teamId))
  const bots =
    list.data?.pages.flatMap(({ data }) =>
      data.items.filter((bot) => bot.availability === 'available' && bot.skillIds.includes(skill.id)),
    ) ?? []
  const openConversation = useOpenDirectConversation(teamId, skill.id)

  return (
    <Dialog open onOpenChange={(open) => !open && !openConversation.isPending && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>使用 {skill.name}</DialogTitle>
          <DialogDescription>选择智能体，技能会带入聊天输入框。</DialogDescription>
        </DialogHeader>
        {list.isPending && <DelayedPageSkeleton />}
        {list.isError && <PageError title="智能体加载失败" error={list.error} onRetry={() => void list.refetch()} />}
        {bots.length > 0 && (
          <div className="project-chat-picker">
            {bots.map((bot) => (
              <Button
                key={bot.id}
                unstyled
                type="button"
                disabled={openConversation.isPending}
                onClick={() => openConversation.mutate(bot.id)}
              >
                <BotAvatar botId={bot.id} avatarKey={bot.avatarKey} />
                <span>
                  <strong>{bot.name}</strong>
                  <small>{bot.responsibility}</small>
                </span>
                <ArrowRight className="icon fill-none stroke-current stroke-2" aria-hidden="true" />
              </Button>
            ))}
          </div>
        )}
        {list.hasNextPage && (
          <Button
            type="button"
            variant="outline"
            disabled={list.isFetchingNextPage}
            onClick={() => void list.fetchNextPage()}
          >
            {list.isFetchingNextPage ? '正在加载…' : '加载更多智能体'}
          </Button>
        )}
        {list.isSuccess && !list.hasNextPage && bots.length === 0 && (
          <EmptyState
            mascot="orbit"
            title="没有可用的智能体"
            description="为智能体配置此技能，并确认智能体可用。"
            action={
              <Button asChild variant="outline">
                <Link to="/capabilities/bots">管理智能体</Link>
              </Button>
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
              if (openConversation.variables) openConversation.mutate(openConversation.variables)
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
