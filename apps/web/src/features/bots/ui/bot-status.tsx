import type { BotView } from '../api/queries'
import { cn } from '@/shared/lib/utils'

const availability = {
  available: { label: '可用', dot: 'green' },
  disabled: { label: '已停用', dot: '' },
  model_unbound: { label: '未绑定模型', dot: 'amber' },
  model_unavailable: { label: '模型不可用', dot: 'amber' },
  worker_offline: { label: '环境离线', dot: '' },
} satisfies Record<BotView['availability'], { label: string; dot: string }>

/** 以原型的状态点和文字展示智能体的真实运行可用性。 */
export function BotStatus({ value }: { value: BotView['availability'] }) {
  const { label, dot } = availability[value]
  return (
    <span className="bot-status">
      <span className={cn('dot', dot)} aria-hidden="true" />
      {label}
    </span>
  )
}
