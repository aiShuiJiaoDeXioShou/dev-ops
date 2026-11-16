import { Avatar } from 'radix-ui'
import { memberInitial } from '@/shared/lib/avatar-tone'
import { cn } from '@/shared/lib/utils'

/**
 * 显示账号头像，图片缺失或加载失败时显示姓名首字。
 * @param props.name 显示名称；image 为头像地址；className 可覆盖默认尺寸。
 * @returns 装饰性头像，调用方应在附近展示姓名或提供可访问名称。
 */
export function ProfileAvatar({ name, image, className }: { name: string; image?: string | null; className?: string }) {
  return (
    <Avatar.Root
      aria-hidden="true"
      className={cn('inline-grid size-7 shrink-0 place-items-center overflow-hidden rounded-full bg-muted', className)}
    >
      {image && <Avatar.Image src={image} alt="" referrerPolicy="no-referrer" className="size-full object-cover" />}
      <Avatar.Fallback className="font-medium text-muted-foreground">{memberInitial(name)}</Avatar.Fallback>
    </Avatar.Root>
  )
}
