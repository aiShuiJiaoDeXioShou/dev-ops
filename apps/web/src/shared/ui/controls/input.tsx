import * as React from 'react'
import { cn } from '@/shared/lib/utils'

/**
 * 渲染与主题一致的单行文本输入框。
 * @param props 原生 input 属性，可覆盖尺寸与间距类名。
 * @returns 受控或非受控输入框；校验与提交行为由调用方决定。
 */
function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'h-9 w-full min-w-0 rounded-lg border border-input bg-background px-3 py-1 text-sm shadow-xs outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50',
        className,
      )}
      {...props}
    />
  )
}

export { Input }
