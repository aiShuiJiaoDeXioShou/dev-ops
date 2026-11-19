import * as React from 'react'
import { AlertDialog as AlertDialogPrimitive } from 'radix-ui'
import { cn } from '@/shared/lib/utils'
import { buttonVariants } from './button'

/** 管理确认对话框的打开状态。 */
function AlertDialog(props: React.ComponentProps<typeof AlertDialogPrimitive.Root>) {
  return <AlertDialogPrimitive.Root data-slot="alert-dialog" {...props} />
}
/** 渲染确认对话框触发器。 */
function AlertDialogTrigger(props: React.ComponentProps<typeof AlertDialogPrimitive.Trigger>) {
  return <AlertDialogPrimitive.Trigger data-slot="alert-dialog-trigger" {...props} />
}
/**
 * 在独立遮罩上显示二次确认内容，并将键盘焦点限制在弹窗内。
 * @param props Radix 内容属性、焦点回调和可选布局类名。
 * @returns 在短视口中可滚动的确认弹窗。
 */
function AlertDialogContent({ className, ...props }: React.ComponentProps<typeof AlertDialogPrimitive.Content>) {
  return (
    <AlertDialogPrimitive.Portal>
      <AlertDialogPrimitive.Overlay className="fixed inset-0 z-50 bg-foreground/30 motion-safe:data-[state=open]:animate-in motion-safe:data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 dark:bg-background/65" />
      <AlertDialogPrimitive.Content
        data-slot="alert-dialog-content"
        className={cn(
          'dialog-w-sm fixed top-1/2 left-1/2 z-50 grid max-h-5/6 max-w-108 -translate-x-1/2 -translate-y-1/2 gap-5 overflow-y-auto overscroll-contain rounded-xl border border-border bg-popover p-5 text-popover-foreground shadow-lg outline-none sm:p-6',
          className,
        )}
        {...props}
      />
    </AlertDialogPrimitive.Portal>
  )
}
/**
 * 对齐确认弹窗的标题与后果说明，允许长名称自然换行。
 * @param props 标题、说明及容器属性。
 * @returns 左对齐的标题区域。
 */
function AlertDialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div data-slot="alert-dialog-header" className={cn('grid gap-2 text-left wrap-anywhere', className)} {...props} />
  )
}
/**
 * 将取消和确认按钮排在阅读顺序中，空间不足时自然换行。
 * @param props 操作按钮及容器属性。
 * @returns 右对齐的操作区，窄屏时为按钮保留触控高度。
 */
function AlertDialogFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-dialog-footer"
      className={cn(
        'flex flex-wrap items-center justify-end gap-2 [&_button]:min-h-13 [&_button]:px-4 [&_button]:text-base sm:[&_button]:min-h-10',
        className,
      )}
      {...props}
    />
  )
}
/**
 * 渲染与确认对话框关联的标题。
 * @param props Radix 标题属性与自定义类名。
 * @returns 对话框的可访问名称。
 */
function AlertDialogTitle({ className, ...props }: React.ComponentProps<typeof AlertDialogPrimitive.Title>) {
  return (
    <AlertDialogPrimitive.Title
      data-slot="alert-dialog-title"
      className={cn('text-xl leading-snug font-semibold', className)}
      {...props}
    />
  )
}
/**
 * 显示操作对象与后果。
 * @param props Radix 描述属性与自定义类名。
 * @returns 与对话框关联的辅助说明。
 */
function AlertDialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Description>) {
  return (
    <AlertDialogPrimitive.Description
      data-slot="alert-dialog-description"
      className={cn('text-base leading-normal text-muted-foreground', className)}
      {...props}
    />
  )
}
/** 渲染取消按钮。 */
function AlertDialogCancel({ className, ...props }: React.ComponentProps<typeof AlertDialogPrimitive.Cancel>) {
  return <AlertDialogPrimitive.Cancel className={cn(buttonVariants({ variant: 'outline' }), className)} {...props} />
}
/** 渲染确认按钮。 */
function AlertDialogAction({ className, ...props }: React.ComponentProps<typeof AlertDialogPrimitive.Action>) {
  return <AlertDialogPrimitive.Action className={cn(buttonVariants(), className)} {...props} />
}
export {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
}
