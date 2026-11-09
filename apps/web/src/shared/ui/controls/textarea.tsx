import * as React from 'react'
import { cn } from '@/shared/lib/utils'

/**
 * 渲染与主题一致的多行文本输入框。
 * @param props 原生 textarea 属性，可覆盖最小高度与间距类名。
 * @returns 多行输入框；内容校验与提交由调用方处理。
 */
function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'min-h-24 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm shadow-xs outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50',
        className,
      )}
      {...props}
    />
  )
}

export { Textarea }
