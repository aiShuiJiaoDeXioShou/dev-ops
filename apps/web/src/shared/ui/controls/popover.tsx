import type { ComponentProps } from 'react'
import { Popover as PopoverPrimitive } from 'radix-ui'
import { cn } from '@/shared/lib/utils'

export const Popover = PopoverPrimitive.Root
export const PopoverTrigger = PopoverPrimitive.Trigger

/**
 * 在触发器旁显示浮层，并把内容挂载到门户以避开父容器裁切。
 * @param props 浮层位置、焦点回调和内容属性。focusPanelOnOpen 将初始焦点放在面板，调用方也可通过 onOpenAutoFocus 自行处理。
 * @returns 使用工作区表面、边框和圆角的浮层内容。
 */
export function PopoverContent({
  className,
  sideOffset = 6,
  focusPanelOnOpen = false,
  onOpenAutoFocus,
  ...props
}: ComponentProps<typeof PopoverPrimitive.Content> & { focusPanelOnOpen?: boolean }) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        sideOffset={sideOffset}
        onOpenAutoFocus={
          onOpenAutoFocus ??
          ((event) => {
            if (!focusPanelOnOpen || !(event.currentTarget instanceof HTMLElement)) return
            event.preventDefault()
            event.currentTarget.focus({ preventScroll: true })
          })
        }
        className={cn(
          'z-50 rounded-lg border border-border bg-popover text-popover-foreground shadow-md outline-none',
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  )
}
