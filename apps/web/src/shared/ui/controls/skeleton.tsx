import { cn } from '@/shared/lib/utils'

/**
 * 渲染加载占位，不生成业务数据。
 * @param props 标准容器属性及占位尺寸类名。
 * @returns 仅用于展示的占位元素。
 */
function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="skeleton" className={cn('animate-pulse rounded-md bg-muted', className)} {...props} />
}

export { Skeleton }
