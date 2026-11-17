import { WorkItemOwnerField } from '@/features/collaboration/ui/work-item-owner-field'
import { WorkItemPlanning } from '@/features/collaboration/ui/work-item-planning'
import { isWorkflowStage, type WorkItemPlan } from '@/features/collaboration/model/work-item-plan'
import { Button } from '@/shared/ui/controls/button'
import { DropdownMenuItem } from '@/shared/ui/controls/dropdown-menu'
import type { BugDetail } from '../model/types'
import type { BugAction } from './bug-action-dialog'

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
  onPlanChange,
}: {
  bug: BugDetail
  canWrite: boolean
  isStarting: boolean
  startError: string
  onStart: () => void
  onAction: (action: BugAction, trigger: HTMLButtonElement | null) => void
  onOwnerChange: (field: 'fixOwnerUserId' | 'regressionOwnerUserId', userId: string | null) => Promise<void>
  onPlanChange: (next: WorkItemPlan) => Promise<void>
}) {
  const { status } = bug
  const active = canWrite ? ACTIONS[status] : undefined
  const canClose = canWrite && status !== 'closed' && status !== 'resolved'

  return (
    <WorkItemPlanning
      kind="bug"
      status={status}
      label="Bug 流程"
      plan={bug.plan}
      canWrite={canWrite}
      onSave={onPlanChange}
      actionError={startError}
      primaryAction={
        active && (
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
        )
      }
      renderCurrentMenu={
        canClose
          ? (trigger) => (
              <>
                {status === 'in_regression' && (
                  <DropdownMenuItem onSelect={() => onAction('withdraw-regression', trigger.current)}>
                    撤回回归
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem className="text-destructive" onSelect={() => onAction('close', trigger.current)}>
                  关闭 Bug
                </DropdownMenuItem>
              </>
            )
          : undefined
      }
      renderOwner={(nodeId, isCurrent) => {
        if (!isWorkflowStage('bug', nodeId)) return null
        const isRegression = nodeId === 'in_regression' || nodeId === 'resolved'
        const canEditOwner = canWrite && isCurrent && status !== 'in_regression'
        return (
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
        )
      }}
    />
  )
}
