import { Check } from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/ui/controls/button'

/**
 * 显示事项的流程进度，点击节点只切换预览。
 * @param props 节点名称、当前与预览位置、当前节点的状态以及选择回调。
 * @returns 可通过键盘操作的节点条。取消或关闭后的状态不在标准流程时隐藏。
 */
export function WorkItemStageRail({
  titles,
  current,
  selected,
  currentProgress,
  onSelect,
}: {
  titles: readonly string[]
  current: number
  selected: number
  currentProgress: string
  onSelect: (index: number) => void
}) {
  if (current < 0) return null
  return (
    <ol aria-label="流程节点" className="work-item-flow-steps">
      {titles.map((title, index) => {
        const completed = index < current || (index === current && currentProgress === '已完成')
        const upcoming = index > current
        const progress = completed ? '已完成' : upcoming ? '未进入' : currentProgress
        return (
          <li key={index} className="min-w-0">
            <Button
              type="button"
              variant="outline"
              aria-current={index === current ? 'step' : undefined}
              aria-pressed={index === selected}
              aria-label={`${title}，${progress}`}
              title={title}
              className={cn(
                'relative z-10 max-w-full min-w-0 gap-1 rounded-full px-1.5 text-xs sm:gap-1.5 sm:px-3 sm:text-sm dark:bg-background dark:hover:bg-muted',
                index === selected && 'border-primary text-primary',
                upcoming && index !== selected && 'text-muted-foreground',
              )}
              onClick={() => onSelect(index)}
            >
              {completed ? (
                <Check className="size-3 text-success" aria-hidden="true" />
              ) : (
                <span
                  className={cn('size-2 shrink-0 rounded-full', upcoming ? 'bg-muted-foreground/40' : 'bg-warning')}
                  aria-hidden="true"
                />
              )}
              <span className="min-w-0 truncate">{title}</span>
            </Button>
          </li>
        )
      })}
    </ol>
  )
}
