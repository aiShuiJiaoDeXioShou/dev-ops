import { cn } from '@/shared/lib/utils'

type IconName =
  | 'search'
  | 'plus'
  | 'file'
  | 'settings'
  | 'more'
  | 'menu'
  | 'send'
  | 'close'
  | 'chat'
  | 'check'
  | 'layers'
  | 'stop'
  | 'inbox'

/**
 * 显示协作原型中的本地图形，颜色跟随控件状态。
 * @param props.name 视图使用的固定图标。
 * @param props.className 调整图标尺寸的可选类。
 * @returns 由外层控件提供名称的装饰图标。
 */
export function ConversationIcon({ name, className }: { name: IconName; className?: string }) {
  return <span className={cn('icon conversation-icon', className)} data-glyph={name} aria-hidden="true" />
}
