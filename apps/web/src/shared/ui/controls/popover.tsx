import type { ComponentProps } from 'react'
import { Popover as PopoverPrimitive } from 'radix-ui'
import { cn } from '@/shared/lib/utils'

export const Popover = PopoverPrimitive.Root
export const PopoverTrigger = PopoverPrimitive.Trigger

/**
 * 在触发器旁显示浮层，并把内容挂载到门户以避开父容器裁切。
 * @param props 浮层位置、焦点回调和内容属性。
 * @returns 使用工作区表面、边框和圆角的浮层内容。
 */
export function PopoverContent({
  className,
  sideOffset = 6,
  ...props
}: ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        sideOffset={sideOffset}
        className={cn(
          'z-50 rounded-lg border border-border bg-popover text-popover-foreground shadow-md outline-none',
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  )
}
