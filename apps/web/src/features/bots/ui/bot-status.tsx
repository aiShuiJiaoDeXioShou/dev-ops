import { Badge } from '@/shared/ui/controls/badge'
import type { BotView } from '../api/queries'

const availability = {
  available: '可运行',
  disabled: '已停用',
  model_unbound: '未绑定模型',
  model_unavailable: '模型不可用',
  worker_offline: '执行服务离线',
} satisfies Record<BotView['availability'], string>

/** 显示 Bot 的运行可用性，保留停用、模型状态和执行服务状态的含义。 */
export function BotStatus({ value }: { value: BotView['availability'] }) {
  return <Badge variant={value === 'available' ? 'secondary' : 'outline'}>{availability[value]}</Badge>
}
