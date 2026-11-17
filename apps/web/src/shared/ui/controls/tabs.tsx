import * as React from 'react'
import { Tabs as TabsPrimitive } from 'radix-ui'
import { cn } from '@/shared/lib/utils'

/** 管理页签的选中状态与键盘交互。 */
function Tabs({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return <TabsPrimitive.Root data-slot="tabs" className={cn('flex min-w-0 flex-col gap-4', className)} {...props} />
}

/**
 * 渲染页签切换列表。
 * @param props Radix 列表属性与自定义类名。
 * @returns 可横向滚动的页签栏。
 */
function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn(
        'inline-flex w-fit items-center gap-1 rounded-lg bg-secondary p-1 text-muted-foreground',
        className,
      )}
      {...props}
    />
  )
}

/**
 * 渲染单个页签触发器。
 * @param props Radix 触发器属性与自定义类名；underline 使用目录的下划线样式。
 * @returns 选中态高亮的页签按钮。
 */
function TabsTrigger({
  className,
  variant = 'default',
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger> & { variant?: 'default' | 'underline' }) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        'inline-flex min-h-8 items-center justify-center gap-1.5 whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50',
        variant === 'underline'
          ? 'tab'
          : 'rounded-md px-3 py-1 text-sm font-medium hover:text-foreground data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm',
        className,
      )}
      {...props}
    />
  )
}

/**
 * 渲染与页签关联的内容区域。
 * @param props Radix 内容属性与自定义类名。
 * @returns 当前页签对应的内容容器。
 */
function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn('min-w-0 flex-1 outline-none', className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent }
