import type { ReactNode } from 'react'
import { cn } from '@/shared/lib/utils'
import { Skeleton, SkeletonRegion } from '@/shared/ui/controls/skeleton'

/**
 * 首屏会话与团队加载时保持与工作区一致的 232px 侧栏与主内容外壳。
 * @param props.children 与当前路由对应的页面专属骨架内容。
 * @returns 带主导航与账号区占位的工作区外壳。
 */
export function AppShellSkeleton({ children }: { children: ReactNode }) {
  return (
    <div className="shell" role="status" aria-busy="true" aria-label="页面加载中">
      <aside className="sidebar" aria-hidden="true">
        <div className="skeleton-brand">
          <Skeleton width={29} height={29} borderRadius="var(--radius-md)" />
          <Skeleton width={88} height={16} />
        </div>
        <div className="skeleton-nav">
          {[0, 1, 2, 3].map((item) => (
            <div key={item} className="flex items-center gap-3 px-3 py-2.5">
              <Skeleton width={18} height={18} borderRadius="var(--radius-sm)" />
              <Skeleton width={item % 2 === 0 ? 72 : 56} height={14} />
            </div>
          ))}
        </div>
        <div className="side-bottom">
          <div className="skeleton-user">
            <Skeleton circle width={26} height={26} />
            <div className="flex flex-1 flex-col gap-1.5">
              <Skeleton width={88} height={12} />
              <Skeleton width={64} height={10} />
            </div>
          </div>
        </div>
      </aside>
      <div className="surface">
        <main className="main">{children}</main>
      </div>
    </div>
  )
}

interface TableSkeletonProps {
  /** 表格每列宽度配置，决定占位比例。 */
  columns?: Array<number | string>
  /** 数据行数量，默认 6 行。 */
  rows?: number
  /** 是否在表格上方渲染筛选工具栏占位。 */
  toolbar?: boolean
  /** 仅面向读屏器的状态标签。 */
  label?: string
  /** 延迟时长（毫秒），传 0 时立即渲染。 */
  delay?: number
  /** 容器附加类名。 */
  className?: string
}

/**
 * 列表/表格区域的结构化骨架占位。
 * @param props 列比例、行数、是否展示工具栏、延迟与读屏标签。
 * @returns 贴合 `.table-wrap` 与筛选栏布局的纯骨架占位。
 */
export function TableSkeleton({
  columns = ['42%', '18%', '18%', '16%'],
  rows = 6,
  toolbar = false,
  label = '列表加载中',
  delay,
  className,
}: TableSkeletonProps) {
  return (
    <SkeletonRegion label={label} delay={delay} className={cn('space-y-4', className)}>
      {toolbar && (
        <div className="flex flex-wrap items-center justify-between gap-3" aria-hidden="true">
          <div className="flex flex-wrap items-center gap-2">
            <Skeleton width={120} height={36} borderRadius="var(--radius-md)" />
            <Skeleton width={220} height={36} borderRadius="var(--radius-md)" />
          </div>
          <Skeleton width={104} height={36} borderRadius="var(--radius-md)" />
        </div>
      )}
      <div className="overflow-hidden rounded-lg border border-border" aria-hidden="true">
        <div className="flex items-center gap-4 border-b border-border bg-secondary px-4 py-3">
          {columns.map((width, index) => (
            <div key={index} className="min-w-0 flex-1">
              <Skeleton width={width} height={12} />
            </div>
          ))}
        </div>
        <div className="divide-y divide-border">
          {Array.from({ length: rows }).map((_, rowIndex) => (
            <div key={rowIndex} className="flex items-center gap-4 px-4 py-3.5">
              {columns.map((width, colIndex) => (
                <div key={colIndex} className="min-w-0 flex-1">
                  <Skeleton
                    width={colIndex === 0 ? (rowIndex % 2 === 0 ? '78%' : '62%') : width}
                    height={colIndex === 0 ? 15 : 13}
                  />
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </SkeletonRegion>
  )
}

interface CardGridSkeletonProps {
  /** 卡片数量，默认 6 张。 */
  count?: number
  /** 是否在卡片顶部显示圆形头像（如智能体）或方形图标（如项目/技能）。 */
  iconShape?: 'circle' | 'square' | 'none'
  /** 描述行数，默认 2 行。 */
  lines?: number
  /** 仅面向读屏器的状态标签。 */
  label?: string
  /** 延迟时长（毫秒）。 */
  delay?: number
  /** 网格容器类名。 */
  className?: string
}

/**
 * 卡片网格区域骨架（项目、技能、智能体、工作流卡片等）。
 * @param props 卡片数量、图标形状、文本行数与网格类名。
 * @returns 贴合目录卡片布局的骨架网格。
 */
export function CardGridSkeleton({
  count = 6,
  iconShape = 'square',
  lines = 2,
  label = '内容加载中',
  delay,
  className,
}: CardGridSkeletonProps) {
  return (
    <SkeletonRegion label={label} delay={delay} className={cn('grid gap-4 sm:grid-cols-2 lg:grid-cols-3', className)}>
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="rounded-xl border border-border bg-card p-4 space-y-3" aria-hidden="true">
          <div className="flex items-center gap-3">
            {iconShape === 'circle' && <Skeleton circle width={36} height={36} />}
            {iconShape === 'square' && <Skeleton width={32} height={32} borderRadius="var(--radius-md)" />}
            <div className="min-w-0 flex-1 space-y-1.5">
              <Skeleton width="60%" height={16} />
              <Skeleton width="35%" height={11} />
            </div>
          </div>
          <div className="space-y-2">
            {Array.from({ length: lines }).map((__, lineIndex) => (
              <Skeleton key={lineIndex} width={lineIndex === lines - 1 ? '68%' : '92%'} height={12} />
            ))}
          </div>
          <div className="flex items-center justify-between pt-2 border-t border-border">
            <Skeleton width={76} height={12} />
            <Skeleton width={52} height={20} borderRadius="var(--radius-full)" />
          </div>
        </div>
      ))}
    </SkeletonRegion>
  )
}

interface DetailSheetSkeletonProps {
  /** 是否展示顶部流程时间线节点条（需求/Bug 详情）。 */
  showTimeline?: boolean
  /** 属性键值对行数，默认 4 行。 */
  propertyRows?: number
  /** 仅面向读屏器的状态标签。 */
  label?: string
  /** 延迟时长（毫秒）。 */
  delay?: number
  /** 容器附加类名。 */
  className?: string
}

/**
 * 详情抽屉与侧栏面板骨架（需求、Bug、PR、技能、智能体、构建详情等）。
 * @param props 是否含流程时间线、属性行数、延迟和读屏标签。
 * @returns 贴合 `.details` 面板结构的纯骨架视图。
 */
export function DetailSheetSkeleton({
  showTimeline = false,
  propertyRows = 4,
  label = '详情加载中',
  delay,
  className,
}: DetailSheetSkeletonProps) {
  return (
    <SkeletonRegion label={label} delay={delay} className={cn('space-y-6 p-5', className)}>
      <div className="space-y-3" aria-hidden="true">
        <div className="flex items-center gap-2">
          <Skeleton width={64} height={22} borderRadius="var(--radius-full)" />
          <Skeleton width={92} height={22} borderRadius="var(--radius-full)" />
        </div>
        <Skeleton width="72%" height={24} />
      </div>

      {showTimeline && (
        <div className="flex items-center gap-3 overflow-hidden py-1" aria-hidden="true">
          {[0, 1, 2, 3].map((step) => (
            <div key={step} className="flex items-center gap-2">
              <Skeleton width={84} height={30} borderRadius="var(--radius-full)" />
              {step < 3 && <Skeleton width={20} height={2} />}
            </div>
          ))}
        </div>
      )}

      <div className="grid gap-3 rounded-lg border border-border p-4 sm:grid-cols-2" aria-hidden="true">
        {Array.from({ length: propertyRows }).map((_, index) => (
          <div key={index} className="flex items-center gap-3">
            <Skeleton width={68} height={13} />
            <div className="min-w-0 flex-1">
              <Skeleton width={index % 2 === 0 ? '68%' : '54%'} height={14} />
            </div>
          </div>
        ))}
      </div>

      <div className="space-y-2.5" aria-hidden="true">
        <Skeleton width={96} height={15} />
        <Skeleton width="96%" height={13} />
        <Skeleton width="88%" height={13} />
        <Skeleton width="74%" height={13} />
      </div>

      <div className="space-y-3 border-t border-border pt-4" aria-hidden="true">
        <Skeleton width={80} height={14} />
        <div className="flex items-start gap-3">
          <Skeleton circle width={28} height={28} />
          <div className="flex-1 space-y-2">
            <Skeleton width="35%" height={12} />
            <Skeleton width="82%" height={13} />
          </div>
        </div>
      </div>
    </SkeletonRegion>
  )
}

interface CompactListSkeletonProps {
  /** 列表项数量，默认 4 条。 */
  rows?: number
  /** 每项左侧是否带圆形头像或方形图标。 */
  leading?: 'avatar' | 'icon' | 'none'
  /** 是否在右侧渲染操作占位。 */
  trailing?: boolean
  /** 是否每行带边框卡片样式。 */
  bordered?: boolean
  /** 仅面向读屏器的状态标签。 */
  label?: string
  /** 延迟时长（毫秒）。 */
  delay?: number
  /** 容器附加类名。 */
  className?: string
}

/**
 * 弹窗选择器、附件、标签、提交历史与侧栏列表的紧凑行骨架。
 * @param props 行数、前置头像/图标、尾部操作、边框与延迟配置。
 * @returns 与真实紧凑列表高度一致的骨架行组。
 */
export function CompactListSkeleton({
  rows = 4,
  leading = 'none',
  trailing = false,
  bordered = false,
  label = '列表加载中',
  delay,
  className,
}: CompactListSkeletonProps) {
  return (
    <SkeletonRegion label={label} delay={delay} className={cn('space-y-2.5', className)}>
      {Array.from({ length: rows }).map((_, index) => (
        <div
          key={index}
          className={cn('flex items-center gap-3', bordered ? 'rounded-lg border border-border p-3' : 'py-2')}
          aria-hidden="true"
        >
          {leading === 'avatar' && <Skeleton circle width={30} height={30} />}
          {leading === 'icon' && <Skeleton width={26} height={26} borderRadius="var(--radius-sm)" />}
          <div className="min-w-0 flex-1 space-y-1.5">
            <Skeleton width={index % 2 === 0 ? '48%' : '62%'} height={14} />
            <Skeleton width={index % 2 === 0 ? '76%' : '54%'} height={11} />
          </div>
          {trailing && <Skeleton width={60} height={28} borderRadius="var(--radius-md)" />}
        </div>
      ))}
    </SkeletonRegion>
  )
}

interface TimelineListSkeletonProps {
  /** 时间线条目数，默认 3 条。 */
  rows?: number
  /** 仅面向读屏器的状态标签。 */
  label?: string
  /** 延迟时长（毫秒）。 */
  delay?: number
  /** 容器附加类名。 */
  className?: string
}

/**
 * 评论与活动时间线骨架，保持头像与正文缩进对齐。
 * @param props 条目数、读屏标签、延迟和类名。
 * @returns 时间线风格的纯骨架列表。
 */
export function TimelineListSkeleton({ rows = 3, label = '记录加载中', delay, className }: TimelineListSkeletonProps) {
  return (
    <SkeletonRegion label={label} delay={delay} className={cn('space-y-4 py-2', className)}>
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="flex items-start gap-3" aria-hidden="true">
          <Skeleton circle width={28} height={28} />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex items-center gap-2">
              <Skeleton width={88} height={13} />
              <Skeleton width={64} height={11} />
            </div>
            <Skeleton width={index % 2 === 0 ? '88%' : '72%'} height={13} />
            {index === 0 && <Skeleton width="56%" height={13} />}
          </div>
        </div>
      ))}
    </SkeletonRegion>
  )
}

interface FormSectionSkeletonProps {
  /** 表单字段数量，默认 4 组。 */
  fields?: number
  /** 仅面向读屏器的状态标签。 */
  label?: string
  /** 延迟时长（毫秒）。 */
  delay?: number
  /** 容器附加类名。 */
  className?: string
}

/**
 * 表单与设置区块骨架，还原标签加输入控件的纵向节奏。
 * @param props 字段数、读屏标签、延迟与类名。
 * @returns 表单风格的纯骨架占位。
 */
export function FormSectionSkeleton({ fields = 4, label = '配置加载中', delay, className }: FormSectionSkeletonProps) {
  return (
    <SkeletonRegion label={label} delay={delay} className={cn('space-y-5 py-2', className)}>
      {Array.from({ length: fields }).map((_, index) => (
        <div key={index} className="space-y-2" aria-hidden="true">
          <Skeleton width={index % 2 === 0 ? 96 : 124} height={13} />
          <Skeleton width="100%" height={index === fields - 1 ? 84 : 36} borderRadius="var(--radius-md)" />
        </div>
      ))}
    </SkeletonRegion>
  )
}

const LOG_LINE_WIDTHS = ['42%', '76%', '64%', '88%', '52%', '71%', '38%', '82%', '60%', '48%']

/**
 * 代码预览、Diff 与流水线日志终端的等宽错落行骨架。
 * @param props.lines 占位行数，默认 10 行。
 * @param props.label 读屏标签。
 * @param props.delay 延迟时长（毫秒）。
 * @returns 代码或日志区域骨架。
 */
export function LogLinesSkeleton({
  lines = 10,
  label = '内容加载中',
  delay,
  className,
}: {
  lines?: number
  label?: string
  delay?: number
  className?: string
}) {
  return (
    <SkeletonRegion
      label={label}
      delay={delay}
      className={cn('space-y-2.5 rounded-lg border border-border bg-secondary/50 p-4', className)}
    >
      {Array.from({ length: lines }).map((_, index) => (
        <div key={index} className="flex items-center gap-3" aria-hidden="true">
          <Skeleton width={28} height={12} />
          <div className="min-w-0 flex-1">
            <Skeleton width={LOG_LINE_WIDTHS[index % LOG_LINE_WIDTHS.length]} height={12} />
          </div>
        </div>
      ))}
    </SkeletonRegion>
  )
}

/**
 * 项目晴雨表（53×7 热力日历）专属骨架。
 * @param props.delay 延迟时长（毫秒）。
 * @returns 与晴雨表卡片同尺寸的骨架占位。
 */
export function BarometerSkeleton({ delay }: { delay?: number }) {
  return (
    <SkeletonRegion
      label="项目晴雨表加载中"
      delay={delay}
      className="rounded-xl border border-border bg-card p-4 space-y-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2" aria-hidden="true">
        <div className="flex items-center gap-3">
          <Skeleton width={96} height={16} />
          <Skeleton width={132} height={13} />
        </div>
        <div className="flex items-center gap-1.5">
          {[0, 1, 2, 3].map((pill) => (
            <Skeleton key={pill} width={52} height={26} borderRadius="var(--radius-full)" />
          ))}
        </div>
      </div>
      <div aria-hidden="true">
        <Skeleton width="100%" height={108} borderRadius="var(--radius-md)" />
      </div>
    </SkeletonRegion>
  )
}

/**
 * 图片、PDF 或文本附件预览窗口的骨架。
 * @param props.delay 延迟时长（毫秒）。
 * @returns 贴合预览模态内容区高度的骨架占位。
 */
export function PreviewSkeleton({ delay }: { delay?: number }) {
  return (
    <SkeletonRegion label="预览加载中" delay={delay} className="space-y-3 py-2">
      <div aria-hidden="true" className="space-y-3">
        <Skeleton width="100%" height={320} borderRadius="var(--radius-lg)" />
        <div className="flex items-center justify-between">
          <Skeleton width={140} height={13} />
          <Skeleton width={88} height={13} />
        </div>
      </div>
    </SkeletonRegion>
  )
}
