import type { ComponentProps } from 'react'
import { Tooltip as TooltipPrimitive } from 'radix-ui'
import { cn } from '@/shared/lib/utils'

export const TooltipProvider = TooltipPrimitive.Provider
export const Tooltip = TooltipPrimitive.Root
export const TooltipTrigger = TooltipPrimitive.Trigger

/**
 * 在悬停或聚焦的控件旁显示补充信息，避免被滚动容器裁切。
 * @param props 提示内容、浮层位置和自定义样式。
 * @returns 在视口内定位的提示浮层，不接管焦点。
 */
export function TooltipContent({
  className,
  sideOffset = 6,
  ...props
}: ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        sideOffset={sideOffset}
        collisionPadding={12}
        className={cn(
          'z-50 max-w-64 rounded-lg border border-border bg-popover px-3 py-2 text-xs leading-5 wrap-anywhere text-popover-foreground shadow-md',
          className,
        )}
        {...props}
      />
    </TooltipPrimitive.Portal>
  )
}
