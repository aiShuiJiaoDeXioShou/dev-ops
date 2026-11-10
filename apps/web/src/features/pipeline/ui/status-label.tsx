import type { ReactNode } from 'react'
import { cn } from '@/shared/lib/utils'
import type { StatusTone } from '../lib/status'

const TONE_DOT_CLASS: Record<StatusTone, string> = {
  neutral: 'dot',
  info: 'dot blue',
  success: 'dot green',
  warning: 'dot amber',
  danger: 'dot red',
}

/**
 * 渲染带语义色状态点的状态文案。
 *
 * 颜色只负责强化语义，文字始终存在，满足“状态不能只靠颜色表达”的规范。
 * @param props.tone 状态语义色；children 为业务状态文案；className 追加布局类。
 * @returns 状态点与文案；无交互。
 */
export function StatusLabel({
  tone,
  children,
  className,
}: {
  tone: StatusTone
  children: ReactNode
  className?: string
}) {
  return (
    <span className={cn('status', className)}>
      <span className={TONE_DOT_CLASS[tone]} aria-hidden="true" />
      {children}
    </span>
  )
}
