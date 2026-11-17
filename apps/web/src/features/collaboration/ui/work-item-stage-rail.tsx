import { useEffect, useRef } from 'react'
import { Check } from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/ui/controls/button'
import type { NodeProgress } from '../model/work-item-plan'

/**
 * 将事项节点显示在同一条可滚动的时间线上。
 * @param props 节点进度、事项所在节点、选中节点及卡片切换回调。
 * @returns 可通过键盘与触控切换的时间线，当前流程状态与选中位置分别标示。
 */
export function WorkItemStageRail({
  steps,
  currentId,
  selectedId,
  cardId,
  onSelect,
}: {
  steps: readonly { id: string; title: string; progress: NodeProgress | null }[]
  currentId: string
  selectedId: string
  cardId: string
  onSelect: (id: string) => void
}) {
  const rail = useRef<HTMLDivElement>(null)
  const selectedStep = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const container = rail.current
    if (!container || !selectedStep.current) return
    const viewport = container.getBoundingClientRect()
    const button = selectedStep.current.getBoundingClientRect()
    if (button.left < viewport.left) container.scrollLeft += button.left - viewport.left
    else if (button.right > viewport.right) container.scrollLeft += button.right - viewport.right
  }, [selectedId, steps.length])

  return (
    <div ref={rail} className="min-w-0 overflow-x-auto px-1 py-1">
      <ol aria-label="流程节点" className="work-item-flow-steps">
        {steps.map(({ id, title, progress }) => (
          <li key={id}>
            <Button
              ref={id === selectedId ? selectedStep : undefined}
              type="button"
              variant="outline"
              aria-current={id === currentId ? 'step' : undefined}
              aria-pressed={id === selectedId}
              aria-controls={cardId}
              aria-label={progress ? title + '，' + progress : title}
              title={title}
              className={cn(
                'relative z-10 min-w-11 max-w-40 gap-1 rounded-full px-2 text-xs sm:gap-1.5 sm:px-3 sm:text-sm dark:bg-background dark:hover:bg-muted',
                id === selectedId && 'border-primary text-primary dark:border-primary',
                id === currentId && id !== selectedId && 'border-primary/50 font-semibold',
                progress === '未进入' && id !== selectedId && 'text-muted-foreground',
              )}
              onClick={() => onSelect(id)}
            >
              {progress === '已完成' ? (
                <Check className="size-3 text-success" aria-hidden="true" />
              ) : (
                progress && (
                  <span
                    className={cn(
                      'size-2 shrink-0 rounded-full',
                      progress === '未进入' ? 'bg-muted-foreground/40' : 'bg-warning',
                    )}
                    aria-hidden="true"
                  />
                )
              )}
              <span className="min-w-0 truncate">{title}</span>
            </Button>
          </li>
        ))}
      </ol>
    </div>
  )
}
