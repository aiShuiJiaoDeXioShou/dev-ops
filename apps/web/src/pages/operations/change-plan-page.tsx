import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router'
import { apiClient } from '@/shared/api/client'
import { describeRequestError } from '@/shared/api/errors'
import { useSession } from '@/features/identity/public'
import { projectQueryOptions } from '@/features/projects/public'
import { Badge } from '@/shared/ui/controls/badge'
import { StatusBadge } from '@/shared/ui/status-badge'
import { Button } from '@/shared/ui/controls/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/controls/dialog'
import { FormField } from '@/shared/ui/controls/form-field'
import { Input } from '@/shared/ui/controls/input'
import { Select } from '@/shared/ui/controls/select'
import { Textarea } from '@/shared/ui/controls/textarea'
import { PageError, PageLoading } from '@/shared/ui/page-state'
import { DelayedLoading } from '@/shared/ui/delayed-loading'
import { useToast } from '@/shared/ui/toast'
import {
  changePlanQueryOptions,
  ENVIRONMENT_LABELS,
  EXECUTION_STATUS_LABELS,
  OPERATION_KIND_LABELS,
  PLAN_STATUS_LABELS,
  VERIFICATION_STATUS_LABELS,
} from '@/features/operations/public'

const PLAN_STATUS_TONES: Record<string, 'neutral' | 'info' | 'success' | 'warning' | 'danger'> = {
  pending: 'warning',
  approved: 'info',
  executing: 'info',
  verifying: 'warning',
  completed: 'success',
  failed: 'danger',
  cancelled: 'neutral',
}

type ConfirmAction = 'approve' | 'execute' | 'verify' | 'cancel' | 'retry'

const ACTION_TITLES: Record<ConfirmAction, string> = {
  approve: '放行变更计划',
  execute: '执行变更计划',
  verify: '验证执行结果',
  cancel: '取消变更计划',
  retry: '核对后重试',
}

/**
 * 变更计划详情页。
 *
 * 展示计划内容、放行、执行与事件；动作由服务端 `actions` 决定，前端不自行推断权限。
 */
export function Component() {
  const { planId = '' } = useParams()
  const { role } = useSession()
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const detail = useQuery(changePlanQueryOptions(planId))
  const project = useQuery({
    ...projectQueryOptions(detail.data?.data.plan.projectId ?? ''),
    enabled: Boolean(detail.data),
  })
  const [action, setAction] = useState<ConfirmAction | null>(null)
  const [note, setNote] = useState('')
  const [reason, setReason] = useState('')
  const [actualVersion, setActualVersion] = useState('')
  const [health, setHealth] = useState<'ok' | 'failing' | 'unknown'>('unknown')
  const canManage = role === 'admin'

  const runAction = useMutation({
    mutationFn: async (input: ConfirmAction) => {
      const payload = detail.data?.data
      if (!payload) throw new Error('计划尚未加载')
      const revision = payload.plan.revision
      switch (input) {
        case 'approve':
          return apiClient.approveChangePlan(planId, { expectedRevision: revision, note: note || null })
        case 'execute':
          return apiClient.executeChangePlan(planId, { expectedRevision: revision })
        case 'verify':
          return apiClient.verifyChangePlan(planId, {
            expectedRevision: revision,
            note: note || null,
            actualVersionLabel: actualVersion || null,
            healthStatus: health,
          })
        case 'cancel':
          return apiClient.cancelChangePlan(planId, { expectedRevision: revision, reason })
        case 'retry':
          return apiClient.retryChangePlan(planId, { expectedRevision: revision, reason })
      }
    },
    onSuccess: async (data, action) => {
      setAction(null)
      setNote('')
      setReason('')
      setActualVersion('')
      await queryClient.invalidateQueries({ queryKey: ['operations', 'change-plan', planId] })
      await queryClient.invalidateQueries({ queryKey: ['operations', 'change-plans'] })
      if (action === 'cancel') {
        const effect = (data as { data?: { externalEffect?: string } }).data?.externalEffect
        const label =
          effect === 'partial' ? '已产生部分外部影响' : effect === 'unknown' ? '外部影响未知，需核对' : '无外部影响'
        showToast(`计划已取消：${label}`, 'success')
      } else {
        showToast('操作已提交', 'success')
      }
    },
    onError: (error: unknown) => showToast(describeRequestError(error).description, 'error'),
  })

  if (detail.isPending) {
    return (
      <DelayedLoading pending>
        <PageLoading message="变更计划加载中…" />
      </DelayedLoading>
    )
  }
  if (detail.isError) {
    return (
      <PageError
        title="变更计划读取失败"
        description={describeRequestError(detail.error).description}
        requestId={describeRequestError(detail.error).requestId}
        retrying={detail.isFetching}
        onRetry={() => void detail.refetch()}
      />
    )
  }
  const { plan, approval, executions, events, actions } = detail.data.data
  const actionPending = runAction.isPending

  return (
    <div className="content">
      <div className="page-head">
        <div>
          <p className="small quiet">
            <Link to="/operations/changes">变更</Link> / {plan.targetResource}
          </p>
          <h1>
            {plan.targetResource} · {plan.versionLabel}
          </h1>
          <p className="small quiet">
            {ENVIRONMENT_LABELS[plan.environment] ?? plan.environment} ·{' '}
            {OPERATION_KIND_LABELS[plan.operationKind] ?? plan.operationKind} · 修订 {plan.revision}
          </p>
        </div>
        <StatusBadge tone={PLAN_STATUS_TONES[plan.status] ?? 'neutral'}>
          {PLAN_STATUS_LABELS[plan.status] ?? plan.status}
        </StatusBadge>
      </div>

      <div className="change-actions">
        {actions.canUpdate && plan.status === 'pending' ? (
          <span className="small quiet">待确认状态可在 CLI 修改计划内容</span>
        ) : null}
        {actions.canApprove ? (
          <Button type="button" onClick={() => setAction('approve')}>
            放行
          </Button>
        ) : null}
        {actions.canExecute ? (
          <Button type="button" onClick={() => setAction('execute')}>
            执行
          </Button>
        ) : null}
        {actions.canVerify ? (
          <Button type="button" onClick={() => setAction('verify')}>
            验证
          </Button>
        ) : null}
        {actions.canRetry ? (
          <Button type="button" variant="outline" onClick={() => setAction('retry')}>
            核对后重试
          </Button>
        ) : null}
        {actions.canCancel ? (
          <Button type="button" variant="ghost" onClick={() => setAction('cancel')}>
            取消
          </Button>
        ) : null}
        {!actions.canApprove && plan.status === 'pending' && canManage ? (
          <span className="small quiet">发起人不能放行自己的计划</span>
        ) : null}
        <Link to={`/projects/${plan.projectId}/artifacts`}>查看产物与版本</Link>
      </div>

      <div className="change-detail-body">
        <div className="change-detail-main">
          <section className="space-y-2">
            <h2>变更范围</h2>
            <p className="whitespace-pre-wrap">{plan.scopeSummary}</p>
            <h2>核对依据</h2>
            <p className="whitespace-pre-wrap">{plan.evidence}</p>
            <h2>恢复方案</h2>
            <p className="whitespace-pre-wrap">{plan.rollbackPlan}</p>
          </section>

          <section className="space-y-3">
            <h2>执行记录</h2>
            {executions.length === 0 ? (
              <p className="small quiet">还没有执行尝试。</p>
            ) : (
              executions.map((execution) => (
                <div key={execution.id} className="event-card">
                  <div className="row spread flex-wrap">
                    <strong>
                      第 {execution.attempt} 次 · {EXECUTION_STATUS_LABELS[execution.status] ?? execution.status}
                    </strong>
                    <Badge variant={execution.verificationStatus === 'passed' ? 'secondary' : 'outline'}>
                      {VERIFICATION_STATUS_LABELS[execution.verificationStatus] ?? execution.verificationStatus}
                    </Badge>
                  </div>
                  <p className="small quiet">
                    预期版本 {execution.expectedVersionLabel} · 实际版本 {execution.actualVersionLabel ?? '未知'} · 健康{' '}
                    {execution.healthStatus ?? '未知'}
                  </p>
                  {execution.pipelineRunId ? (
                    <Link to={`/projects/${plan.projectId}/pipelines/${execution.pipelineRunId}`}>查看流水线运行</Link>
                  ) : null}
                  {execution.status === 'interrupted' || execution.status === 'timed_out' ? (
                    <p className="small">执行未确认结束，请核对实际状态后重试或验证。</p>
                  ) : null}
                  {execution.errorMessage ? <p className="small">{execution.errorMessage}</p> : null}
                </div>
              ))
            )}
          </section>

          <section className="space-y-3">
            <h2>事件</h2>
            {events.length === 0 ? (
              <p className="small quiet">还没有事件记录。</p>
            ) : (
              <ol className="space-y-2">
                {events.map((event) => (
                  <li key={event.id} className="small">
                    <span className="quiet">{new Date(event.createdAt).toLocaleString()}</span> ·{' '}
                    {event.actor?.name ?? '未知用户'} · {event.summary}
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
        <aside className="change-detail-side" aria-label="计划属性">
          <dl className="work-properties">
            <dt>项目</dt>
            <dd>{project.data?.data.name ?? plan.projectId}</dd>
            <dt>目标环境</dt>
            <dd>{ENVIRONMENT_LABELS[plan.environment] ?? plan.environment}</dd>
            <dt>执行方式</dt>
            <dd>{plan.executionMode === 'platform_pipeline' ? '平台流水线' : '外部执行系统'}</dd>
            <dt>部署工作流</dt>
            <dd>
              {plan.workflowPath ?? '不适用'}
              {plan.workflowRef ? ` @ ${plan.workflowRef}` : ''}
            </dd>
            <dt>发起人</dt>
            <dd>{plan.createdBy?.name ?? '未知用户'}</dd>
            <dt>放行</dt>
            <dd>
              {approval
                ? `${approval.approvedBy?.name ?? '未知用户'} · ${new Date(approval.approvedAt).toLocaleString()}`
                : '未放行'}
            </dd>
            <dt>创建时间</dt>
            <dd>{new Date(plan.createdAt).toLocaleString()}</dd>
          </dl>
        </aside>
      </div>

      <Dialog open={action !== null} onOpenChange={(open) => (!open ? setAction(null) : undefined)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{action ? ACTION_TITLES[action] : ''}</DialogTitle>
          </DialogHeader>
          <p className="small quiet">
            环境 {ENVIRONMENT_LABELS[plan.environment] ?? plan.environment} · 版本 {plan.versionLabel} · 修订{' '}
            {plan.revision}
          </p>
          {action === 'verify' ? (
            <div className="space-y-3">
              <FormField label="实际运行版本" help="产物缺失时必须填写">
                <Input value={actualVersion} onChange={(event) => setActualVersion(event.target.value)} />
              </FormField>
              <FormField label="健康状态">
                <Select
                  value={health}
                  onChange={(event) => setHealth(event.target.value as 'ok' | 'failing' | 'unknown')}
                >
                  <option value="ok">正常</option>
                  <option value="failing">异常</option>
                  <option value="unknown">未知</option>
                </Select>
              </FormField>
            </div>
          ) : null}
          {action === 'cancel' || action === 'retry' ? (
            <FormField label={action === 'cancel' ? '取消原因' : '核对结论'} required>
              <Textarea
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder={action === 'cancel' ? '说明取消原因与实际影响' : '说明核对结论：未生效或已修复配置'}
              />
            </FormField>
          ) : null}
          {action === 'approve' ? (
            <FormField label="放行说明">
              <Textarea value={note} onChange={(event) => setNote(event.target.value)} />
            </FormField>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setAction(null)} disabled={actionPending}>
              取消
            </Button>
            <Button
              type="button"
              onClick={() => action && runAction.mutate(action)}
              disabled={
                actionPending ||
                ((action === 'cancel' || action === 'retry') && reason.trim().length === 0) ||
                (action === 'verify' && actualVersion.trim().length === 0 && health !== 'ok')
              }
            >
              {actionPending ? '提交中…' : '确认'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
