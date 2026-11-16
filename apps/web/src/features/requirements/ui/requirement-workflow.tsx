import { useRef, useState } from 'react'
import { Check, Ellipsis } from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/ui/controls/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/shared/ui/controls/dropdown-menu'
import { StatusBadge } from '@/shared/ui/status-badge'
import { UserAvatar } from '@/shared/ui/user-avatar'
import type { RequirementDetail } from '../model/types'
import type { RequirementAction } from './requirement-action-dialog'

const STEPS = ['pending', 'in_development', 'submitted', 'in_testing', 'passed'] as const
const STEP_LABELS: Record<RequirementDetail['status'], string> = {
  pending: '待处理',
  in_development: '开发',
  submitted: '待测试',
  in_testing: '测试',
  passed: '已通过',
  cancelled: '已取消',
}

type StartAction = 'start-development' | 'start-test'
type WorkflowAction = { label: string; kind: RequirementAction | StartAction }

const PRIMARY_ACTIONS: Partial<Record<RequirementDetail['status'], WorkflowAction>> = {
  pending: { label: '开始开发', kind: 'start-development' },
  in_development: { label: '提测', kind: 'submit-test' },
  submitted: { label: '开始测试', kind: 'start-test' },
  in_testing: { label: '测试通过', kind: 'pass-test' },
  cancelled: { label: '恢复需求', kind: 'restore' },
}
const SECONDARY_ACTIONS: Partial<Record<RequirementDetail['status'], { label: string; kind: RequirementAction }>> = {
  submitted: { label: '撤回测试', kind: 'withdraw-test' },
  in_testing: { label: '退回开发', kind: 'return-to-development' },
  passed: { label: '重新开发', kind: 'reopen-development' },
}

function stepState(step: number, current: number) {
  if (step < current) return { label: '已完成', tone: 'success' } as const
  if (step > current) return { label: '未进入', tone: 'neutral' } as const
  if (STEPS[step] === 'passed') return { label: '已完成', tone: 'success' } as const
  if (STEPS[step] === 'pending' || STEPS[step] === 'submitted') return { label: '待开始', tone: 'warning' } as const
  return { label: '进行中', tone: 'warning' } as const
}

/**
 * 展示需求的当前流程位置，允许预览节点并在当前节点执行可用动作。
 * @param props 需求、是否可写、提交状态与动作回调。预览节点不会提交状态变更。
 * @returns 流程进度和节点卡片，状态刷新后显示当前节点。
 */
export function RequirementWorkflow({
  requirement,
  canWrite,
  isStarting,
  startError,
  onStart,
  onAction,
}: {
  requirement: RequirementDetail
  canWrite: boolean
  isStarting: boolean
  startError: string
  onStart: (action: StartAction) => void
  onAction: (action: RequirementAction, trigger: HTMLButtonElement | null) => void
}) {
  const { status } = requirement
  const menu = useRef<HTMLButtonElement>(null)
  const [preview, setPreview] = useState<{ current: RequirementDetail['status']; index: number } | null>(null)
  const currentIndex = STEPS.findIndex((step) => step === status)
  const selectedIndex = preview?.current === status ? preview.index : currentIndex
  const selected = STEPS[selectedIndex] ?? status
  const isCurrent = selected === status
  const primary = canWrite && isCurrent ? PRIMARY_ACTIONS[status] : undefined
  const secondary = canWrite && isCurrent ? SECONDARY_ACTIONS[status] : undefined
  const state = status === 'cancelled' ? null : stepState(selectedIndex, currentIndex)
  const usesTestOwner = selected === 'submitted' || selected === 'in_testing' || selected === 'passed'
  const owner = usesTestOwner ? requirement.testOwner : requirement.devOwner

  return (
    <section className="space-y-4" aria-label="需求流程">
      {currentIndex >= 0 && (
        <ol aria-label="流程节点" className="requirement-flow-steps">
          {STEPS.map((step, index) => {
            const progress = stepState(index, currentIndex)
            return (
              <li key={step}>
                <Button
                  type="button"
                  variant="outline"
                  aria-current={step === status ? 'step' : undefined}
                  aria-pressed={index === selectedIndex}
                  aria-label={`${STEP_LABELS[step]}，${progress.label}`}
                  className={cn(
                    'relative z-10 gap-1 rounded-full px-1.5 text-xs sm:gap-1.5 sm:px-3 sm:text-sm',
                    index === selectedIndex && 'border-primary text-primary',
                    progress.tone === 'neutral' && index !== selectedIndex && 'text-muted-foreground',
                  )}
                  onClick={() => setPreview({ current: status, index })}
                >
                  {progress.tone === 'success' ? (
                    <Check className="size-3 text-success" aria-hidden="true" />
                  ) : (
                    <span
                      aria-hidden="true"
                      className={cn(
                        'size-2 shrink-0 rounded-full',
                        progress.tone === 'warning' ? 'bg-warning' : 'bg-muted-foreground/40',
                      )}
                    />
                  )}
                  {STEP_LABELS[step]}
                </Button>
              </li>
            )
          })}
        </ol>
      )}
      <div className="space-y-3 rounded-xl border border-border bg-card p-3 sm:p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold sm:text-base">{STEP_LABELS[selected]}</h3>
            {state && <StatusBadge tone={state.tone}>{state.label}</StatusBadge>}
          </div>
          {(primary || secondary) && (
            <div className="requirement-flow-actions ml-auto flex items-center gap-2">
              {primary && (
                <Button
                  type="button"
                  size="lg"
                  className="min-w-28 sm:min-w-36"
                  disabled={isStarting}
                  onClick={(event) => {
                    const { kind } = primary
                    if (kind === 'start-development' || kind === 'start-test') onStart(kind)
                    else onAction(kind, event.currentTarget)
                  }}
                >
                  {isStarting ? '处理中…' : primary.label}
                </Button>
              )}
              {secondary && (
                <DropdownMenu modal={false}>
                  <DropdownMenuTrigger asChild>
                    <Button
                      ref={menu}
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="requirement-more-button"
                      aria-label="更多节点操作"
                    >
                      <Ellipsis aria-hidden="true" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => onAction(secondary.kind, menu.current)}>
                      {secondary.label}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          )}
        </div>
        {status !== 'cancelled' && (
          <dl className="rounded-lg border border-border px-3 py-2.5">
            <dt className="text-xs text-muted-foreground">{usesTestOwner ? '测试负责人' : '研发负责人'}</dt>
            <dd className="mt-1 flex min-h-6 items-center gap-2 text-sm wrap-anywhere">
              {owner && <UserAvatar name={owner.name} toneSeed={owner.userId} className="size-6" />}
              {owner?.name ?? '未指定'}
            </dd>
          </dl>
        )}
        {startError && (
          <p role="alert" className="text-sm text-destructive">
            {startError}
          </p>
        )}
      </div>
    </section>
  )
}
