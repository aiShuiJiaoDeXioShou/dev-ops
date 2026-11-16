import { useState, type ReactNode } from 'react'
import { Maximize2, Minimize2 } from 'lucide-react'
import { Button } from './button'
import { Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle } from './sheet'

/**
 * 需求和 Bug 共用的详情浮层，列表保留在原位，详情独立滚动。
 * @param props 浮层标题、事项摘要、正文和关闭回调。
 * @returns 支持展开、键盘关闭与焦点归还的详情浮层。
 */
export function WorkItemDetailSheet({
  label,
  heading,
  children,
  onClose,
}: {
  label: string
  heading?: ReactNode
  children: ReactNode
  onClose: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [trigger] = useState(() => (document.activeElement instanceof HTMLElement ? document.activeElement : null))
  const ExpandIcon = expanded ? Minimize2 : Maximize2

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        aria-describedby={undefined}
        className="work-item-detail-sheet gap-0 bg-background text-foreground outline-none motion-reduce:animate-none"
        data-expanded={expanded}
        showCloseButton={false}
        onCloseAutoFocus={(event) => {
          if (!trigger?.isConnected || trigger === document.body) return
          event.preventDefault()
          trigger.focus({ preventScroll: true })
        }}
      >
        <SheetHeader className="flex-row items-center justify-between gap-2 border-b border-border px-6 py-2">
          <SheetTitle>{label}</SheetTitle>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="hidden lg:inline-flex"
              onClick={() => setExpanded(!expanded)}
            >
              <ExpandIcon className="size-4" aria-hidden="true" />
              {expanded ? '退出全屏' : '全屏'}
            </Button>
            <SheetClose asChild>
              <Button type="button" variant="ghost" size="sm" className="pointer-coarse:min-h-11">
                返回列表
              </Button>
            </SheetClose>
          </div>
        </SheetHeader>
        {heading && <div className="work-item-detail-heading border-b border-border">{heading}</div>}
        <div className="work-item-detail-body min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
      </SheetContent>
    </Sheet>
  )
}
