import { cn } from '@/shared/lib/utils'

/**
 * 渲染原型成员首字头像。
 * @param props.name 成员名；props.className 自定义类名。
 * @returns 使用原型 `.avatar` 样式的圆头像；不加载真实头像图片。
 */
export function MemberAvatar({ name, className }: { name: string; className?: string }) {
  return (
    <span className={cn('avatar', className)} aria-hidden="true">
      {name.slice(0, 1)}
    </span>
  )
}

const botMarks: Record<string, string> = {
  项目助手: 'orbit',
  小李: 'orbit',
  小林: 'prism',
  小渡: 'signal',
  星野: 'aperture',
}

/**
 * 渲染与 HTML 原型一致的 Bot 头像资源。
 * @param props.name Bot 名称；props.mark 可选头像标识；props.size 头像尺寸；props.live 是否使用在线形象；props.className 自定义类名。
 * @returns 本地 Bot SVG 头像，不加载远端图片。
 */
export function BotAvatar({
  name,
  mark,
  size = 'md',
  live = true,
  className,
}: {
  name: string
  mark?: string
  size?: 'sm' | 'md' | 'lg'
  live?: boolean
  className?: string
}) {
  const sizeClass = size === 'sm' ? 'small' : size === 'lg' ? 'large' : ''
  const resolved = mark ?? botMarks[name] ?? 'orbit'
  return (
    <img
      src={`/prototype/bots/bot-${resolved}${live ? '-live' : ''}.svg`}
      alt=""
      aria-hidden="true"
      width={40}
      height={40}
      className={cn('bot-avatar', sizeClass, className)}
    />
  )
}

/**
 * 渲染原型群组会话的多 Bot 叠放头像。
 * @param props.names 参与 Bot 名称；props.className 自定义类名。
 * @returns 使用 `.bot-group-avatar` 与 `.members-N` 样式的组合头像。
 */
export function BotGroupAvatar({ names, className }: { names: string[]; className?: string }) {
  return (
    <span
      className={cn('bot-group-avatar', `members-${Math.min(Math.max(names.length, 1), 3)}`, className)}
      title={names.join('、')}
    >
      {names.slice(0, 3).map((name) => (
        <BotAvatar key={name} name={name} size="sm" />
      ))}
    </span>
  )
}
