import { Button } from '@/shared/ui/controls/button'
import { DropdownMenuItem } from '@/shared/ui/controls/dropdown-menu'
import { WorkItemOwnerField } from '@/features/collaboration/ui/work-item-owner-field'
import { WorkItemPlanning } from '@/features/collaboration/ui/work-item-planning'
import { isWorkflowStage, type WorkItemPlan } from '@/features/collaboration/model/work-item-plan'
import type { RequirementDetail } from '../model/types'
import type { RequirementAction } from './requirement-action-dialog'

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
  onOwnerChange,
  onPlanChange,
}: {
  requirement: RequirementDetail
  canWrite: boolean
  isStarting: boolean
  startError: string
  onStart: (action: StartAction) => void
  onAction: (action: RequirementAction, trigger: HTMLButtonElement | null) => void
  onOwnerChange: (field: 'devOwnerUserId' | 'testOwnerUserId', userId: string | null) => Promise<void>
  onPlanChange: (next: WorkItemPlan) => Promise<void>
}) {
  const { status } = requirement
  const primary = canWrite ? PRIMARY_ACTIONS[status] : undefined
  const secondary = canWrite ? SECONDARY_ACTIONS[status] : undefined

  return (
    <WorkItemPlanning
      kind="requirement"
      status={status}
      label="需求流程"
      plan={requirement.plan}
      canWrite={canWrite}
      onSave={onPlanChange}
      actionError={startError}
      primaryAction={
        primary && (
          <Button
            type="button"
            size="lg"
            className="min-w-28 sm:min-w-36"
            disabled={isStarting}
            onClick={(event) => {
              if (primary.kind === 'start-development' || primary.kind === 'start-test') onStart(primary.kind)
              else onAction(primary.kind, event.currentTarget)
            }}
          >
            {isStarting ? '处理中…' : primary.label}
          </Button>
        )
      }
      renderCurrentMenu={
        secondary
          ? (trigger) => (
              <DropdownMenuItem onSelect={() => onAction(secondary.kind, trigger.current)}>
                {secondary.label}
              </DropdownMenuItem>
            )
          : undefined
      }
      renderOwner={(nodeId, isCurrent) => {
        if (!isWorkflowStage('requirement', nodeId)) return null
        const usesTestOwner = nodeId === 'submitted' || nodeId === 'in_testing' || nodeId === 'passed'
        return (
          <WorkItemOwnerField
            teamId={requirement.teamId}
            label={usesTestOwner ? '测试负责人' : '研发负责人'}
            owner={usesTestOwner ? requirement.testOwner : requirement.devOwner}
            onSave={
              canWrite && isCurrent
                ? (id) => onOwnerChange(usesTestOwner ? 'testOwnerUserId' : 'devOwnerUserId', id)
                : undefined
            }
          />
        )
      }}
    />
  )
}
