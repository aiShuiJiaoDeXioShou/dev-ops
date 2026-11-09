import * as React from "react"
import { cn } from "@/shared/lib/utils"
import { Separator as SeparatorPrimitive } from "radix-ui"

/**
 * 渲染方向可配置的视觉分隔。
 * @param props Radix 分隔组件属性，包括方向和装饰语义。
 * @returns 视觉或语义分隔元素。
 */
function Separator({
  className,
  orientation = "horizontal",
  decorative = true,
  ...props
}: React.ComponentProps<typeof SeparatorPrimitive.Root>) {
  return (
    <SeparatorPrimitive.Root
      data-slot="separator"
      decorative={decorative}
      orientation={orientation}
      className={cn(
        "shrink-0 bg-border data-horizontal:h-px data-horizontal:w-full data-vertical:w-px data-vertical:self-stretch",
        className
      )}
      {...props}
    />
  )
}

export { Separator }
