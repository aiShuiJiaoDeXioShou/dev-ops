import type { ReactNode } from 'react'
import { cn } from '@/shared/lib/utils'

export type TagVariant = 'neutral' | 'blue' | 'green' | 'red'

/**
 * 渲染原型风格的状态/分类标签。
 * @param props.children 标签文案；variant 语义颜色；className 额外布局类。
 * @returns 浅色底、小圆角的标签；不使用描边胶囊样式。
 */
export function Tag({
  children,
  variant = 'neutral',
  className,
}: {
  children: ReactNode
  variant?: TagVariant
  className?: string
}) {
  return <span className={cn('badge', variant !== 'neutral' && variant, className)}>{children}</span>
}
