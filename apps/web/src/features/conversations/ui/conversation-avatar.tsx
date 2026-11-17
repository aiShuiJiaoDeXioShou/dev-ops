import { BotAvatar } from '@/features/bots/ui/bot-avatar'
import { ConversationIcon } from './conversation-icon'

type Avatar = { id: string; avatarKey?: string | null; enabled?: boolean }

/**
 * 按原型展示独立头像或按人数排布的群组头像。头像以 Leader 为首，由调用者提供顺序。
 * @param props.kind 私聊或群组。
 * @param props.bots 当前会话的真实 Bot。
 * @returns 装饰头像，名称由相邻文字提供。
 */
export function ConversationAvatar({ kind, bots }: { kind: 'direct' | 'group'; bots: Avatar[] }) {
  const visible = bots.slice(0, 4)
  const first = visible[0]
  if (!first) return <ConversationIcon name="chat" />
  if (kind === 'direct')
    return <BotAvatar botId={first.id} avatarKey={first.avatarKey ?? null} enabled={first.enabled} />
  return (
    <span className={`bot-group-avatar members-${visible.length}`}>
      {visible.map((bot) => (
        <BotAvatar key={bot.id} botId={bot.id} avatarKey={bot.avatarKey ?? null} enabled={bot.enabled} />
      ))}
    </span>
  )
}
