import { cn } from '@/shared/lib/utils'

const avatarKeys = ['orbit', 'prism', 'signal', 'aperture']

/**
 * 显示原型的本地智能体头像。
 * @param props.avatarKey 库内头像标识，缺失时按 Bot 标识稳定选择。
 * @param props.botId Bot 标识，用于稳定选择默认头像。
 * @param props.large 目录详情使用大尺寸。
 * @param props.enabled 已停用的 Bot 使用静态头像。
 * @returns 装饰头像，名称由相邻文字提供。
 */
export function BotAvatar({
  avatarKey,
  botId,
  large = false,
  enabled = true,
}: {
  avatarKey: string | null
  botId: string
  large?: boolean
  enabled?: boolean
}) {
  const mark =
    avatarKeys.find((key) => key === avatarKey) ??
    avatarKeys[Number.parseInt(botId.slice(-1), 16) % avatarKeys.length] ??
    'orbit'
  return (
    <img
      src={`/prototype/bots/bot-${mark}${enabled ? '-live' : ''}.svg`}
      alt=""
      width={40}
      height={40}
      className={cn('bot-avatar', large && 'large')}
    />
  )
}
