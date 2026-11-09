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
/** 渲染确认对话框内容。 */
function AlertDialogContent({ className, ...props }: React.ComponentProps<typeof AlertDialogPrimitive.Content>) {
  return (
    <AlertDialogPrimitive.Portal>
      <AlertDialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/25 data-[state=open]:animate-in data-[state=closed]:animate-out" />
      <AlertDialogPrimitive.Content
        data-slot="alert-dialog-content"
        className={cn(
          'fixed top-1/2 left-1/2 z-50 grid w-[min(460px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-2xl border bg-background p-6 shadow-2xl outline-none',
          className,
        )}
        {...props}
      />
    </AlertDialogPrimitive.Portal>
  )
}
/** 渲染确认对话框标题区域。 */
function AlertDialogHeader(props: React.ComponentProps<'div'>) {
  return <div data-slot="alert-dialog-header" className="space-y-1.5 text-left" {...props} />
}
/** 渲染确认对话框底部操作。 */
function AlertDialogFooter(props: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-dialog-footer"
      className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"
      {...props}
    />
  )
}
/** 渲染确认对话框标题。 */
function AlertDialogTitle({ className, ...props }: React.ComponentProps<typeof AlertDialogPrimitive.Title>) {
  return (
    <AlertDialogPrimitive.Title
      data-slot="alert-dialog-title"
      className={cn('text-lg font-semibold', className)}
      {...props}
    />
  )
}
/** 渲染确认对话框说明。 */
function AlertDialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Description>) {
  return (
    <AlertDialogPrimitive.Description
      data-slot="alert-dialog-description"
      className={cn('text-sm text-muted-foreground', className)}
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
