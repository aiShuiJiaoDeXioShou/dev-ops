import * as React from 'react'
import { ChevronDownIcon } from 'lucide-react'
import { cn } from '@/shared/lib/utils'

/**
 * 渲染使用原生 select 的下拉选择器，沿用原型中的筛选与表单交互。
 * @param props 原生 select 属性，可覆盖尺寸与间距类名。
 * @returns 下拉选择器；选项由 children 提供。
 */
function Select({ className, children, ...props }: React.ComponentProps<'select'>) {
  return (
    <span className={cn('relative inline-flex min-w-0 items-center', className)}>
      <select
        data-slot="select"
        className="h-9 w-full appearance-none rounded-lg border border-input bg-background py-1 pr-8 pl-3 text-sm shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50"
        {...props}
      >
        {children}
      </select>
      <ChevronDownIcon
        className="pointer-events-none absolute right-2.5 size-4 text-muted-foreground"
        aria-hidden="true"
      />
    </span>
  )
}

export { Select }
