import type { ReactNode } from 'react'
import { cn } from '@/shared/lib/utils'

const blueStatuses = ['开发中', '待审核', '进行中', '待测试', '测试中']
const greenStatuses = ['测试通过', '已解决', '已完成', '已合并', '已结束']
const amberStatuses = ['修复中', '已暂停', '暂停', '待回归']

/**
 * 渲染与原型 `status()` 完全一致的状态点与文本。
 * @param props.status 业务状态；props.className 可选附加类名。
 * @returns 使用原型 .status/.dot 类名的状态标记。
 */
export function ProtoStatus({ status, className }: { status: string; className?: string }) {
  const color = blueStatuses.includes(status)
    ? 'blue'
    : greenStatuses.includes(status)
      ? 'green'
      : amberStatuses.includes(status)
        ? 'amber'
        : ''
  return (
    <span className={cn('status', className)}>
      <span className={cn('dot', color)} />
      {status}
    </span>
  )
}

/**
 * 渲染与原型一致的成员首字头像。
 * @param props.name 成员名。
 * @returns 使用原型 .avatar 样式的圆头像。
 */
export function ProtoAvatar({ name }: { name: string }) {
  return <span className="avatar">{name.slice(0, 1)}</span>
}

const chipToneClass: Record<string, string> = {
  success: 'work-chip success',
  warning: 'work-chip warning',
  selected: 'work-chip selected',
}

/**
 * 渲染原型工作页使用的小型状态标签。
 * @param props.children 标签内容；props.tone 颜色语义。
 * @returns 使用 .work-chip 样式的标签。
 */
export function ProtoChip({ children, tone }: { children: ReactNode; tone?: 'success' | 'warning' | 'selected' }) {
  return <span className={tone ? chipToneClass[tone] : 'work-chip'}>{children}</span>
}
