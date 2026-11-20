import * as React from 'react'
import { Tabs as TabsPrimitive } from 'radix-ui'
import { cn } from '@/shared/lib/utils'
import './tabs.css'

/** 管理页签的选中状态与键盘交互。 */
function Tabs({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return <TabsPrimitive.Root data-slot="tabs" className={cn('flex min-w-0 flex-col gap-4', className)} {...props} />
}

/**
 * 渲染页签切换列表。
 * @param props Radix 列表属性与自定义类名。unstyled 允许页面沿用已有页签布局。
 * @returns 可横向滚动的页签栏。
 */
function TabsList({
  className,
  unstyled = false,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List> & { unstyled?: boolean }) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn(
        !unstyled && 'inline-flex w-fit items-center gap-1 rounded-lg bg-secondary p-1 text-muted-foreground',
        className,
      )}
      {...props}
    />
  )
}

/**
 * 渲染单个页签触发器。
 * @param props Radix 触发器属性与自定义类名；underline 使用目录下划线，unstyled 使用调用者的样式。
 * @returns 选中态高亮的页签按钮；键盘操作时显示焦点轮廓。
 */
function TabsTrigger({
  className,
  variant = 'default',
  onMouseDown,
  onKeyDown,
  onBlur,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger> & { variant?: 'default' | 'underline' | 'unstyled' }) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        'disabled:pointer-events-none disabled:opacity-50',
        variant !== 'unstyled' &&
          'inline-flex min-h-8 items-center justify-center gap-1.5 whitespace-nowrap transition-colors',
        variant === 'underline' && 'tab',
        variant === 'default' &&
          'rounded-md px-3 py-1 text-sm font-medium hover:text-foreground data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm',
        className,
      )}
      {...props}
      onMouseDown={(event) => {
        onMouseDown?.(event)
        if (event.defaultPrevented || event.button !== 0 || event.ctrlKey) return
        // Radix 会在鼠标按下时同步聚焦；触屏轻点也会派发兼容的鼠标事件。
        const trigger = event.currentTarget
        trigger.dataset.pointerFocus = ''
        queueMicrotask(() => {
          if (trigger.ownerDocument.activeElement !== trigger) delete trigger.dataset.pointerFocus
        })
      }}
      onKeyDown={(event) => {
        delete event.currentTarget.dataset.pointerFocus
        onKeyDown?.(event)
      }}
      onBlur={(event) => {
        delete event.currentTarget.dataset.pointerFocus
        onBlur?.(event)
      }}
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
