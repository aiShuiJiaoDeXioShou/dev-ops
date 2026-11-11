import * as React from 'react'
import { Dialog as DialogPrimitive } from 'radix-ui'
import { XIcon } from 'lucide-react'
import { cn } from '@/shared/lib/utils'

/** 对话框投影；表单与默认弹窗共用，避免新增任意值。 */
const DIALOG_SHADOW = 'shadow-[0_24px_80px_-20px_rgba(15,23,42,0.35)]'

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

type DialogContentLayout = 'default' | 'form'

/**
 * 渲染对话框遮罩与内容容器。
 * @param props Radix 内容属性、关闭按钮显示选项、布局与自定义类名。
 * @returns 居中的对话框内容；form 布局为固定标题栏 + 可滚动内容区 + 固定底部操作栏，默认布局保持既有滚动行为。
 */
function DialogContent({
  className,
  children,
  showCloseButton = true,
  layout = 'default',
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean
  /** default：整块内容滚动（既有行为）；form：仅字段区滚动，标题与底部操作栏固定。 */
  layout?: DialogContentLayout
}) {
  // 受控弹窗没有 DialogTrigger 时 Radix 会把焦点交还 body；在打开时记录触发元素，
  // 关闭时归还焦点，满足键盘/读屏用户的连续操作预期。
  const triggerElementRef = React.useRef<HTMLElement | null>(
    typeof document === 'undefined' ? null : (document.activeElement as HTMLElement | null),
  )
  const layoutClassName =
    layout === 'form'
      ? `form-dialog-content flex flex-col gap-0 overflow-hidden rounded-xl border border-border bg-background p-0 ${DIALOG_SHADOW} outline-none`
      : `grid max-h-[85svh] w-[min(520px,calc(100vw-32px))] content-start gap-6 overflow-y-auto rounded-xl border border-border bg-background p-6 ${DIALOG_SHADOW} outline-none`
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[#101828]/40 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        data-layout={layout}
        className={cn('fixed top-1/2 left-1/2 z-50 -translate-x-1/2 -translate-y-1/2', layoutClassName, className)}
        {...props}
        onCloseAutoFocus={(event) => {
          props.onCloseAutoFocus?.(event)
          if (event.defaultPrevented) return
          event.preventDefault()
          triggerElementRef.current?.focus()
        }}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            className="absolute top-4 right-4 grid size-8 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
          >
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
  return <div data-slot="dialog-header" className={cn('flex flex-col gap-2.5 pr-8 text-left', className)} {...props} />
}

/**
 * 渲染表单弹窗的固定标题栏；不随字段内容滚动。
 * @param props 标题内容与自定义类名。
 * @returns 带下边框的标题栏；窄屏内边距 16px，桌面 24px。
 */
function DialogFormHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="dialog-form-header"
      className={cn('flex shrink-0 flex-col gap-1 border-b border-border px-4 py-4 pr-12 sm:px-6', className)}
      {...props}
    />
  )
}

/**
 * 渲染表单弹窗的可滚动内容区；超长内容只在这里滚动。
 * @param props 字段内容与自定义类名。
 * @returns 占满剩余高度、纵向滚动的容器；窄屏内边距 16px，桌面 24px。
 */
function DialogFormBody({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="dialog-form-body"
      className={cn('min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-6', className)}
      {...props}
    />
  )
}

/**
 * 渲染表单弹窗的固定底部操作栏；内容滚动时始终可见。
 * @param props 按钮组与自定义类名。
 * @returns 带上边框的操作栏；按钮右对齐，窄屏保持右对齐并允许换行。
 */
function DialogFormFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="dialog-form-footer"
      className={cn(
        'flex shrink-0 flex-wrap-reverse items-center justify-end gap-3 border-t border-border px-4 py-4 sm:px-6',
        className,
      )}
      {...props}
    />
  )
}

/** 渲染对话框底部操作区域。 */
function DialogFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn('flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end', className)}
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
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn('text-[17px] leading-6 font-semibold tracking-[-0.01em]', className)}
      {...props}
    />
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
      className={cn('text-[13px] leading-6 text-muted-foreground', className)}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogFormHeader,
  DialogFormBody,
  DialogFormFooter,
  DialogFooter,
  DialogTitle,
  DialogDescription,
}
