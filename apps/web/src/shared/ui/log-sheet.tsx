import type { ReactNode } from 'react'
import { cn } from '@/shared/lib/utils'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/shared/ui/controls/sheet'

/**
 * 统一的使用/调用日志侧边抽屉：小图标触发，内容独立滚动，底部可放说明。
 * 页面不再把审计型长列表直接铺在主内容下方。
 * @param props.open 打开状态；onOpenChange 状态回调。
 * @param props.title 抽屉标题；description 副标题说明。
 * @param props.children 日志内容；footer 底部补充说明。
 * @param props.className 可选的额外类名。
 * @returns 右侧日志抽屉。
 */
export function LogSheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  className,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  children: ReactNode
  footer?: ReactNode
  className?: string
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className={cn('log-sheet', className)}>
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>{description}</SheetDescription>
        </SheetHeader>
        <div className="log-sheet-body">{children}</div>
        {footer ? <div className="log-sheet-footnote">{footer}</div> : null}
      </SheetContent>
    </Sheet>
  )
}
