import { Check, Crown } from 'lucide-react'
import { useId } from 'react'
import type { BotView } from '@/features/bots/api/queries'
import { BotAvatar } from '@/features/bots/ui/bot-avatar'
import { BotStatus } from '@/features/bots/ui/bot-status'
import { Button } from '@/shared/ui/controls/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/ui/controls/tooltip'
import './conversation-bot-option.css'

type GroupBotSelection = {
  checked: boolean
  isLeader: boolean
  onSetLeader: () => void
}

/**
 * 在会话选择区显示智能体的头像、名称和可用状态，聚焦或悬停时显示职责。
 * @param props 智能体、点击回调和提交状态；群组传入勾选状态与独立的 Leader 设置动作。
 * @returns 可用键盘操作的列表项，只有已选且可用的智能体显示 Leader 控件。
 */
export function ConversationBotOption({
  bot,
  disabled,
  onSelect,
  selection,
}: {
  bot: Pick<BotView, 'id' | 'name' | 'status' | 'avatarKey' | 'responsibility' | 'availability' | 'modelId'>
  disabled: boolean
  onSelect: () => void
  selection?: GroupBotSelection
}) {
  const statusId = useId()
  const responsibility = bot.responsibility?.trim()
  const showLeader = selection?.checked && bot.availability === 'available'
  const choice = (
    <Button
      unstyled
      type="button"
      className="conversation-bot-choice"
      role={selection ? 'checkbox' : undefined}
      aria-checked={selection?.checked}
      aria-label={bot.name}
      aria-describedby={statusId}
      disabled={disabled}
      onClick={onSelect}
    >
      {selection && (
        <span className="conversation-bot-check" aria-hidden="true">
          {selection.checked && <Check className="size-3" strokeWidth={2.5} />}
        </span>
      )}
      <span className="conversation-bot-avatar">
        <BotAvatar botId={bot.id} avatarKey={bot.avatarKey} enabled={bot.status === 'enabled'} />
      </span>
      <strong className="min-w-0 text-sm leading-5 font-semibold wrap-anywhere">{bot.name}</strong>
      <span id={statusId} className="rounded-md bg-muted px-2 py-0.5">
        <BotStatus value={bot.availability} />
      </span>
      {responsibility && (
        <span className="conversation-bot-touch-details text-xs leading-5 wrap-anywhere text-muted-foreground">
          {responsibility}
        </span>
      )}
    </Button>
  )

  return (
    <li className="conversation-bot-option" data-selected={selection?.checked || undefined}>
      {responsibility || bot.modelId ? (
        <Tooltip>
          <TooltipTrigger asChild>{choice}</TooltipTrigger>
          <TooltipContent>
            {responsibility && <div>{responsibility}</div>}
            {bot.modelId && <div className="text-muted-foreground">{bot.modelId}</div>}
          </TooltipContent>
        </Tooltip>
      ) : (
        choice
      )}
      {showLeader && (
        <Button
          type="button"
          unstyled
          className="conversation-bot-leader"
          aria-label={`将${bot.name}设为 Leader`}
          aria-pressed={selection.isLeader}
          disabled={disabled}
          onClick={() => {
            if (!selection.isLeader) selection.onSetLeader()
          }}
        >
          <Crown className="size-3.5 shrink-0" aria-hidden="true" />
          {selection.isLeader ? 'Leader' : '设为 Leader'}
        </Button>
      )}
    </li>
  )
}
