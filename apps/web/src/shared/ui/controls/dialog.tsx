import * as React from 'react'
import { Dialog as DialogPrimitive } from 'radix-ui'
import { XIcon } from 'lucide-react'
import { cn } from '@/shared/lib/utils'

/** 管理对话框的打开状态与焦点上下文。 */
function Dialog({ ...props }: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

/** 渲染打开对话框的触发元素。 */
function DialogTrigger({ ...props }: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

/** 渲染关闭对话框的触发元素。 */
function DialogClose({ ...props }: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

/**
 * 渲染对话框遮罩与内容容器。
 * @param props Radix 内容属性、关闭按钮显示选项与自定义类名。
 * @returns 居中的对话框内容；关闭时由 Radix 恢复焦点。
 */
function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/25 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          'fixed top-1/2 left-1/2 z-50 grid max-h-[85svh] w-[min(540px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto rounded-2xl border bg-background p-6 shadow-2xl outline-none',
          className,
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close className="absolute top-5 right-5 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50">
            <XIcon className="size-4" aria-hidden="true" />
            <span className="sr-only">关闭</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
}

/**
 * 渲染对话框标题区域。
 * @param props 标题、说明及自定义类名。
 * @returns 顶部标题与可选副标题。
 */
function DialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="dialog-header" className={cn('flex flex-col gap-1.5 pr-8 text-left', className)} {...props} />
}

/** 渲染对话框底部操作区域。 */
function DialogFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)}
      {...props}
    />
  )
}

/**
 * 渲染对话框标题。
 * @param props Radix 标题属性与自定义类名。
 * @returns 与对话框关联的可访问标题。
 */
function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title data-slot="dialog-title" className={cn('text-lg font-semibold', className)} {...props} />
  )
}

/**
 * 渲染对话框说明文字。
 * @param props Radix 描述属性与自定义类名。
 * @returns 辅助说明；没有说明时可省略。
 */
function DialogDescription({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn('text-sm text-muted-foreground', className)}
      {...props}
    />
  )
}

export { Dialog, DialogTrigger, DialogClose, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription }
