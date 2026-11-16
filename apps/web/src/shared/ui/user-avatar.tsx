import { Avatar } from 'radix-ui'
import { avatarToneClassName, memberInitial } from '@/shared/lib/avatar-tone'
import { cn } from '@/shared/lib/utils'

/**
 * 显示用户头像，图片缺失或加载失败时显示姓名首字。
 * @param props.name 显示名称；image 为头像地址；toneSeed 为首字占位的配色种子；className 可覆盖尺寸。
 * @returns 装饰性头像，调用方应在附近展示姓名或提供可访问名称。
 */
export function UserAvatar({
  name,
  image,
  toneSeed,
  className,
}: {
  name: string
  image?: string | null
  toneSeed?: string
  className?: string
}) {
  return (
    <Avatar.Root
      data-slot="user-avatar"
      aria-hidden="true"
      className={cn(
        'inline-grid size-7 shrink-0 place-items-center overflow-hidden rounded-full text-xs font-medium',
        toneSeed ? avatarToneClassName(toneSeed) : 'bg-muted text-muted-foreground',
        className,
      )}
    >
      {image && <Avatar.Image src={image} alt="" referrerPolicy="no-referrer" className="size-full object-cover" />}
      <Avatar.Fallback>{memberInitial(name)}</Avatar.Fallback>
    </Avatar.Root>
  )
}
