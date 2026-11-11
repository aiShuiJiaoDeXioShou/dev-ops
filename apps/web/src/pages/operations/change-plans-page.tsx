import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { apiClient } from '@/shared/api/client'
import { describeRequestError } from '@/shared/api/errors'
import { useSession } from '@/features/identity/public'
import { projectListQueryOptions } from '@/features/projects/public'
import { Button } from '@/shared/ui/controls/button'
import { Badge } from '@/shared/ui/controls/badge'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/controls/dialog'
import { FormField } from '@/shared/ui/controls/form-field'
import { Input } from '@/shared/ui/controls/input'
import { Select } from '@/shared/ui/controls/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/controls/table'
import { Textarea } from '@/shared/ui/controls/textarea'
import { PageError, PageLoading } from '@/shared/ui/page-state'
import { DelayedLoading } from '@/shared/ui/delayed-loading'
import { useToast } from '@/shared/ui/toast'
import { changePlanListQueryOptions, type ChangePlanListQuery } from '@/features/operations/public'
import { ENVIRONMENT_LABELS, OPERATION_KIND_LABELS, PLAN_STATUS_LABELS } from '@/features/operations/public'

const STATUS_OPTIONS = ['pending', 'approved', 'executing', 'verifying', 'completed', 'failed', 'cancelled'] as const
const ENVIRONMENT_OPTIONS = ['development', 'test', 'production'] as const
const KIND_OPTIONS = ['deploy_version', 'database_change', 'server_cleanup', 'cloud_resource_change'] as const

interface CreateFormState {
  projectId: string
  operationKind: string
  environment: string
  serviceId: string
  targetResource: string
  versionLabel: string
  scopeSummary: string
  evidence: string
  rollbackPlan: string
  workflowPath: string
  workflowRef: string
}

const INITIAL_FORM: CreateFormState = {
  projectId: '',
  operationKind: 'deploy_version',
  environment: 'test',
  serviceId: '',
  targetResource: '',
  versionLabel: '',
  scopeSummary: '',
  evidence: '',
  rollbackPlan: '',
  workflowPath: '.devops/workflows/deploy-test.yml',
  workflowRef: 'main',
}

/** 从 URL 读取列表筛选条件。 */
function parseFilters(search: URLSearchParams): ChangePlanListQuery {
  return {
    page: Number(search.get('page') ?? '1') || 1,
    pageSize: 20,
    ...(search.get('status') ? { status: search.get('status') as ChangePlanListQuery['status'] } : {}),
    ...(search.get('environment')
      ? { environment: search.get('environment') as ChangePlanListQuery['environment'] }
      : {}),
    ...(search.get('kind') ? { operationKind: search.get('kind') as ChangePlanListQuery['operationKind'] } : {}),
    ...(search.get('projectId') ? { projectId: search.get('projectId') as string } : {}),
  }
}

/**
 * 运维 / 变更列表页。
 *
 * 团队范围内按项目、环境、状态与类型筛选；浏览者可读，开发者/管理员可新建计划。
 */
export function Component() {
  const { currentTeam, role, isReady } = useSession()
  const teamId = currentTeam?.id ?? ''
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const [createOpen, setCreateOpen] = useState(false)
  const [form, setForm] = useState<CreateFormState>(INITIAL_FORM)
  const filters = useMemo(() => parseFilters(searchParams), [searchParams])
  const plans = useQuery(changePlanListQueryOptions(teamId, filters))
  const projects = useQuery(projectListQueryOptions(teamId, { page: 1, pageSize: 100 }))
  const canCreate = role === 'admin' || role === 'developer'

  const createPlan = useMutation({
    mutationFn: async () => {
      const result = await apiClient.createChangePlan(form.projectId, {
        operationKind: form.operationKind as 'deploy_version',
        environment: form.environment as 'test',
        serviceId: form.serviceId || null,
        targetResource: form.targetResource,
        versionLabel: form.versionLabel,
        scopeSummary: form.scopeSummary,
        evidence: form.evidence,
        rollbackPlan: form.rollbackPlan,
        executionMode: 'platform_pipeline',
        workflowPath: form.workflowPath || null,
        workflowRef: form.workflowRef || null,
      })
      return result
    },
    onSuccess: async (result) => {
      setCreateOpen(false)
      setForm(INITIAL_FORM)
      await queryClient.invalidateQueries({ queryKey: ['operations', 'change-plans', teamId] })
      showToast('变更计划已创建', 'success')
      navigate(`/operations/changes/${result.data.plan.id}`)
    },
    onError: (error: unknown) => showToast(describeRequestError(error).description, 'error'),
  })

  const setFilter = (name: string, value: string) => {
    const next = new URLSearchParams(searchParams)
    if (value) next.set(name, value)
    else next.delete(name)
    next.delete('page')
    setSearchParams(next)
  }

  if (!isReady) return <PageLoading message="团队信息加载中…" />
  if (plans.isPending) {
    return (
      <DelayedLoading pending>
        <PageLoading message="变更计划加载中…" />
      </DelayedLoading>
    )
  }
  if (plans.isError) {
    return (
      <PageError
        title="变更计划读取失败"
        description={describeRequestError(plans.error).description}
        requestId={describeRequestError(plans.error).requestId}
        retrying={plans.isFetching}
        onRetry={() => void plans.refetch()}
      />
    )
  }

  const planPage = plans.data.data
  const items = planPage.items
  const hasFilters = Boolean(filters.status || filters.environment || filters.operationKind || filters.projectId)
  const projectItems = projects.data?.data.items ?? []
  const projectNames = new Map(projectItems.map((project) => [project.id, project.name]))

  return (
    <div className="content">
      <div className="page-head">
        <div>
          <h1>变更</h1>
          <p className="small quiet">创建具体变更计划，人工放行后执行并验证运行版本。</p>
        </div>
        {canCreate ? (
          <Button type="button" onClick={() => setCreateOpen(true)} disabled={projectItems.length === 0}>
            新建变更计划
          </Button>
        ) : null}
      </div>

      <div className="row spread flex-wrap gap-3">
        <div className="row flex-wrap gap-2">
          <Select
            aria-label="按项目筛选"
            value={filters.projectId ?? ''}
            onChange={(event) => setFilter('projectId', event.target.value)}
          >
            <option value="">全部项目</option>
            {projectItems.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </Select>
          <Select
            aria-label="按环境筛选"
            value={filters.environment ?? ''}
            onChange={(event) => setFilter('environment', event.target.value)}
          >
            <option value="">全部环境</option>
            {ENVIRONMENT_OPTIONS.map((value) => (
              <option key={value} value={value}>
                {ENVIRONMENT_LABELS[value]}
              </option>
            ))}
          </Select>
          <Select
            aria-label="按状态筛选"
            value={filters.status ?? ''}
            onChange={(event) => setFilter('status', event.target.value)}
          >
            <option value="">全部状态</option>
            {STATUS_OPTIONS.map((value) => (
              <option key={value} value={value}>
                {PLAN_STATUS_LABELS[value]}
              </option>
            ))}
          </Select>
          <Select
            aria-label="按操作类型筛选"
            value={filters.operationKind ?? ''}
            onChange={(event) => setFilter('kind', event.target.value)}
          >
            <option value="">全部类型</option>
            {KIND_OPTIONS.map((value) => (
              <option key={value} value={value}>
                {OPERATION_KIND_LABELS[value]}
              </option>
            ))}
          </Select>
        </div>
        <span className="small quiet">共 {planPage.total} 条</span>
      </div>

      {items.length === 0 ? (
        <div className="empty empty-state">
          <h2>{hasFilters ? '没有匹配的变更计划' : '还没有变更计划'}</h2>
          <p>{hasFilters ? '清除筛选后重试，或新建一条计划。' : '部署前先建立计划，写清版本、范围与恢复方案。'}</p>
          {hasFilters ? (
            <Button type="button" variant="outline" onClick={() => setSearchParams(new URLSearchParams())}>
              清除筛选
            </Button>
          ) : null}
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>目标 / 版本</TableHead>
              <TableHead>项目</TableHead>
              <TableHead>环境</TableHead>
              <TableHead>类型</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>发起人</TableHead>
              <TableHead>更新时间</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((plan) => (
              <TableRow key={plan.id}>
                <TableCell>
                  <Link to={`/operations/changes/${plan.id}`}>
                    {plan.targetResource} · {plan.versionLabel}
                  </Link>
                </TableCell>
                <TableCell>{projectNames.get(plan.projectId) ?? plan.projectId.slice(0, 8)}</TableCell>
                <TableCell>{ENVIRONMENT_LABELS[plan.environment] ?? plan.environment}</TableCell>
                <TableCell>{OPERATION_KIND_LABELS[plan.operationKind] ?? plan.operationKind}</TableCell>
                <TableCell>
                  <Badge variant={plan.status === 'failed' ? 'destructive' : 'secondary'}>
                    {PLAN_STATUS_LABELS[plan.status] ?? plan.status}
                  </Badge>
                </TableCell>
                <TableCell>{plan.createdBy?.name ?? '未知用户'}</TableCell>
                <TableCell>{new Date(plan.updatedAt).toLocaleString()}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新建变更计划</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <FormField label="项目" required>
              <Select
                value={form.projectId}
                onChange={(event) => setForm({ ...form, projectId: event.target.value, serviceId: '' })}
              >
                <option value="">请选择项目</option>
                {projectItems.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="操作类型" required>
              <Select
                value={form.operationKind}
                onChange={(event) => setForm({ ...form, operationKind: event.target.value })}
              >
                {KIND_OPTIONS.map((value) => (
                  <option key={value} value={value}>
                    {OPERATION_KIND_LABELS[value]}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="目标环境" required>
              <Select
                value={form.environment}
                onChange={(event) => setForm({ ...form, environment: event.target.value })}
              >
                {ENVIRONMENT_OPTIONS.map((value) => (
                  <option key={value} value={value}>
                    {ENVIRONMENT_LABELS[value]}
                  </option>
                ))}
              </Select>
            </FormField>
            {form.operationKind === 'deploy_version' ? (
              <FormField label="部署工作流" required>
                <Input
                  value={form.workflowPath}
                  onChange={(event) => setForm({ ...form, workflowPath: event.target.value })}
                  placeholder=".devops/workflows/deploy-test.yml"
                />
              </FormField>
            ) : null}
            <FormField label="目标服务或资源" required>
              <Input
                value={form.targetResource}
                onChange={(event) => setForm({ ...form, targetResource: event.target.value })}
                placeholder="web"
              />
            </FormField>
            <FormField label="版本或迁移标识" required>
              <Input
                value={form.versionLabel}
                onChange={(event) => setForm({ ...form, versionLabel: event.target.value })}
                placeholder="v1.4.0"
              />
            </FormField>
            <FormField label="变更范围" required>
              <Textarea
                value={form.scopeSummary}
                onChange={(event) => setForm({ ...form, scopeSummary: event.target.value })}
                placeholder="写清本次版本、环境、资源与动作"
              />
            </FormField>
            <FormField label="核对依据" required>
              <Textarea
                value={form.evidence}
                onChange={(event) => setForm({ ...form, evidence: event.target.value })}
              />
            </FormField>
            <FormField label="恢复方案" required>
              <Textarea
                value={form.rollbackPlan}
                onChange={(event) => setForm({ ...form, rollbackPlan: event.target.value })}
                placeholder="回滚版本或不可回滚时的处理办法"
              />
            </FormField>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setCreateOpen(false)}>
              取消
            </Button>
            <Button
              type="button"
              onClick={() => createPlan.mutate()}
              disabled={
                createPlan.isPending ||
                !form.projectId ||
                !form.targetResource ||
                !form.versionLabel ||
                !form.scopeSummary ||
                !form.evidence ||
                !form.rollbackPlan
              }
            >
              {createPlan.isPending ? '保存中…' : '保存计划'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
