import { useRef, useState } from 'react'
import { Ellipsis } from 'lucide-react'
import { WorkItemOwnerField } from '@/features/collaboration/ui/work-item-owner-field'
import { WorkItemStageRail } from '@/features/collaboration/ui/work-item-stage-rail'
import { planNodes, WORK_ITEM_STAGES } from '@/features/collaboration/model/work-item-plan'
import { Button } from '@/shared/ui/controls/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/shared/ui/controls/dropdown-menu'
import { StatusBadge } from '@/shared/ui/status-badge'
import type { BugDetail } from '../model/types'
import type { BugAction } from './bug-action-dialog'

const STEPS = WORK_ITEM_STAGES.bug.map(([id]) => id)
const ACTIONS: Record<BugDetail['status'], { label: string; kind: BugAction | 'start' }> = {
  pending: { label: '开始修复', kind: 'start' },
  in_fix: { label: '提交回归', kind: 'submit-regression' },
  in_regression: { label: '记录回归结论', kind: 'record-regression' },
  resolved: { label: '重开', kind: 'reopen' },
  closed: { label: '重开', kind: 'reopen' },
}

/**
 * 展示 Bug 修复流程，当前节点承载对应操作。
 * @param props Bug、写入权限、修复中状态和动作回调。
 * @returns 流程条和当前或预览节点的操作卡片。
 */
export function BugWorkflow({
  bug,
  canWrite,
  isStarting,
  startError,
  onStart,
  onAction,
  onOwnerChange,
}: {
  bug: BugDetail
  canWrite: boolean
  isStarting: boolean
  startError: string
  onStart: () => void
  onAction: (action: BugAction, trigger: HTMLButtonElement | null) => void
  onOwnerChange: (field: 'fixOwnerUserId' | 'regressionOwnerUserId', userId: string | null) => Promise<void>
}) {
  const { status } = bug
  const menu = useRef<HTMLButtonElement>(null)
  const [preview, setPreview] = useState<{ status: BugDetail['status']; index: number } | null>(null)
  const current = STEPS.findIndex((step) => step === status)
  const selectedIndex = preview?.status === status ? preview.index : current
  const selected = STEPS[selectedIndex] ?? status
  const isCurrent = status === selected
  const titles = planNodes('bug', bug.plan)
    .slice(0, STEPS.length)
    .map((node) => node.title)
  const currentProgress = status === 'resolved' ? '已完成' : status === 'in_fix' ? '进行中' : '待开始'
  const progress = selectedIndex < current ? '已完成' : selectedIndex > current ? '未进入' : currentProgress
  const active = canWrite && isCurrent ? ACTIONS[status] : undefined
  const canClose = canWrite && isCurrent && status !== 'closed' && status !== 'resolved'
  const isRegression = selected === 'in_regression' || selected === 'resolved'
  const canEditOwner = canWrite && isCurrent && (!isRegression || status !== 'in_regression')

  return (
    <section className="space-y-4" aria-label="Bug 流程">
      <WorkItemStageRail
        titles={titles}
        current={current}
        selected={selectedIndex}
        currentProgress={currentProgress}
        onSelect={(index) => setPreview({ status, index })}
      />
      <div className="space-y-3 rounded-xl border border-border bg-card p-3 sm:p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold wrap-anywhere sm:text-base">{titles[selectedIndex] ?? '已关闭'}</h3>
            {status !== 'closed' && (
              <StatusBadge tone={progress === '已完成' ? 'success' : progress === '未进入' ? 'neutral' : 'warning'}>
                {progress}
              </StatusBadge>
            )}
          </div>
          {active && (
            <div className="work-item-flow-actions ml-auto flex items-center gap-2">
              <Button
                size="lg"
                type="button"
                className="min-w-28 sm:min-w-36"
                disabled={isStarting}
                onClick={(event) => {
                  if (active.kind === 'start') onStart()
                  else onAction(active.kind, event.currentTarget)
                }}
              >
                {isStarting ? '处理中…' : active.label}
              </Button>
              {canClose && (
                <DropdownMenu modal={false}>
                  <DropdownMenuTrigger asChild>
                    <Button
                      ref={menu}
                      variant="ghost"
                      size="icon"
                      className="work-item-icon-button"
                      type="button"
                      aria-label="更多节点操作"
                    >
                      <Ellipsis aria-hidden="true" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {status === 'in_regression' && (
                      <DropdownMenuItem onSelect={() => onAction('withdraw-regression', menu.current)}>
                        撤回回归
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem className="text-destructive" onSelect={() => onAction('close', menu.current)}>
                      关闭 Bug
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          )}
        </div>
        <dl className="rounded-lg border border-border px-3 py-2.5">
          <WorkItemOwnerField
            teamId={bug.teamId}
            label={isRegression ? '回归负责人' : '修复负责人'}
            owner={isRegression ? bug.regressionOwner : bug.fixOwner}
            onSave={
              canEditOwner
                ? (id) => onOwnerChange(isRegression ? 'regressionOwnerUserId' : 'fixOwnerUserId', id)
                : undefined
            }
          />
        </dl>
        {startError && (
          <p role="alert" className="text-sm text-destructive">
            {startError}
          </p>
        )}
      </div>
    </section>
  )
}
