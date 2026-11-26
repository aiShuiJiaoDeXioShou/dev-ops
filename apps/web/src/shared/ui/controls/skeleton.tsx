import type { ReactNode } from 'react'
import LoadingSkeleton, { type SkeletonProps as ReactLoadingSkeletonProps } from 'react-loading-skeleton'
import { cn } from '@/shared/lib/utils'
import { DelayedLoading } from '@/shared/ui/delayed-loading'

export type SkeletonProps = ReactLoadingSkeletonProps

/**
 * 基于 react-loading-skeleton 的统一骨架占位原语。
 * 默认绑定项目明暗主题变量，确保独立测试和常规页面都能呈现一致的色彩与圆角。
 * @param props react-loading-skeleton 支持的尺寸、圆角、圆形与数量等属性。
 * @returns 不包含业务数据与可见文字的骨架占位元素。
 */
export function Skeleton({
  baseColor = 'var(--skeleton-base)',
  highlightColor = 'var(--skeleton-highlight)',
  borderRadius = 'var(--radius-sm)',
  containerClassName,
  className,
  inline,
  ...props
}: SkeletonProps) {
  return (
    <LoadingSkeleton
      baseColor={baseColor}
      highlightColor={highlightColor}
      borderRadius={borderRadius}
      inline={inline}
      containerClassName={cn(inline ? 'inline-block leading-none' : 'block leading-none', containerClassName)}
      className={className}
      {...props}
    />
  )
}

interface SkeletonRegionProps {
  /** 仅面向辅助技术的加载区域说明，不在界面上渲染可见文案。 */
  label?: string
  /** 延迟出现时长（毫秒）；传 0 时立即渲染，省略则沿用全局 200ms 延迟。 */
  delay?: number
  /** 容器附加类名，用于贴合目标页面的真实布局容器。 */
  className?: string
  /** 骨架结构内容。 */
  children: ReactNode
}

/**
 * 带统一延迟显现与无障碍状态语义的骨架容器。
 * @param props 区域标签、延迟毫秒数、布局类名和骨架内容。
 * @returns 达到延迟后渲染的结构化骨架容器。
 */
export function SkeletonRegion({ label = '页面加载中', delay, className, children }: SkeletonRegionProps) {
  return (
    <DelayedLoading pending delay={delay}>
      <div role="status" aria-busy="true" aria-label={label} className={className}>
        {children}
      </div>
    </DelayedLoading>
  )
}
