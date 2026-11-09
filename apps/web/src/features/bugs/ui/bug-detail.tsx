import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { isBusinessError } from '@dev-ops/api-client'
import { apiClient } from '@/shared/api/client'
import { Badge } from '@/shared/ui/controls/badge'
import { Button } from '@/shared/ui/controls/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/controls/tabs'
import { ActivityTimeline, CommentForm, CommentList } from '@/features/collaboration/public'
import { CodeReferenceDialog } from '@/features/code/public'
import { useSession } from '@/features/identity/public'
import { describeRequestError } from '@/shared/api/errors'
import { formatDateTime } from '@/shared/lib/format'
import { PageError, PageLoading } from '@/shared/ui/page-state'
import { bugMutations, canWriteBugs, isEditableBug } from '../api/mutations'
import { bugQueryOptions } from '../api/queries'
import { BUG_STATUS_LABELS, REGRESSION_RESULT_LABELS } from '../model/labels'
import { queryOptions } from '@tanstack/react-query'
import { BugActionDialog, type BugAction } from './bug-action-dialog'
import { BugForm } from './bug-form'
import { Select } from '@/shared/ui/controls/select'

/** Bug 详情：基本信息、回归历史、动作、评论与活动。 */
export function BugDetailPane({ bugId, onClose }: { bugId: string; onClose: () => void }) {
  const queryClient = useQueryClient()
  const { role } = useSession()
  const query = useQuery(bugQueryOptions(bugId))
  const [action, setAction] = useState<BugAction | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [linkRequirementId, setLinkRequirementId] = useState('')
  const [error, setError] = useState('')
  const [codeOpen, setCodeOpen] = useState(false)
  const canWrite = canWriteBugs(role)
  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ['bugs'] })
    await queryClient.invalidateQueries({ queryKey: ['projects'] })
  }
  const refreshCode = useMutation({
    mutationFn: (codeReferenceId: string) => apiClient.refreshCodeReference(codeReferenceId),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ['bugs', 'detail', bugId] }),
    onError: (cause: unknown) => setError(isBusinessError(cause) ? cause.message : '代码引用刷新失败。'),
  })
  const requirements = useQuery(
    queryOptions({
      queryKey: ['bugs', 'link-requirements', query.data?.data.projectId],
      queryFn: ({ signal }) =>
        apiClient.listRequirements(query.data?.data.projectId ?? '', { pageSize: 100 }, { signal }),
      enabled: Boolean(query.data?.data.projectId),
    }),
  )
  const link = useMutation({
    mutationFn: () =>
      apiClient.linkBugRequirement(bugId, { version: query.data?.data.version ?? 0, requirementId: linkRequirementId }),
    onSuccess: async () => {
      setLinkRequirementId('')
      await queryClient.invalidateQueries({ queryKey: ['bugs', 'detail', bugId] })
    },
    onError: (cause: unknown) => setError(isBusinessError(cause) ? cause.message : '关联需求失败。'),
  })
  const startFix = useMutation({
    mutationFn: () => bugMutations.startFix(bugId, { version: query.data?.data.version ?? 0 }),
    onSuccess: invalidate,
    onError: (cause: unknown) => setError(isBusinessError(cause) ? cause.message : '开始修复失败。'),
  })
  if (query.isPending) return <PageLoading message="Bug 加载中…" />
  if (query.isError) {
    const described = describeRequestError(query.error)
    return (
      <PageError
        title="Bug 加载失败"
        description={described.description}
        requestId={described.requestId}
        onRetry={() => void query.refetch()}
      />
    )
  }
  const bug = query.data.data
  return (
    <aside className="space-y-5 rounded-xl border bg-card p-5">
      <header className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs text-muted-foreground">Bug #{bug.number}</p>
          <h2 className="mt-1 text-lg font-semibold leading-6">{bug.title}</h2>
          <div className="mt-2 flex flex-wrap gap-2">
            <Badge variant="outline">{BUG_STATUS_LABELS[bug.status]}</Badge>
            <span className="text-xs text-muted-foreground">更新 {formatDateTime(bug.updatedAt)}</span>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose}>
          关闭
        </Button>
      </header>
      <div className="flex flex-wrap gap-2">
        {canWrite && bug.status === 'pending' && (
          <Button size="sm" onClick={() => startFix.mutate()} disabled={startFix.isPending}>
            开始修复
          </Button>
        )}
        {canWrite && bug.status === 'in_fix' && (
          <Button size="sm" onClick={() => setAction('submit-regression')}>
            提交回归
          </Button>
        )}
        {canWrite && bug.status === 'in_regression' && (
          <Button size="sm" onClick={() => setAction('record-regression')}>
            记录回归结论
          </Button>
        )}
        {canWrite && bug.status === 'in_regression' && (
          <Button size="sm" variant="outline" onClick={() => setAction('withdraw-regression')}>
            撤回回归
          </Button>
        )}
        {canWrite && ['pending', 'in_fix', 'in_regression'].includes(bug.status) && (
          <Button size="sm" variant="outline" onClick={() => setAction('close')}>
            关闭
          </Button>
        )}
        {canWrite && ['resolved', 'closed'].includes(bug.status) && (
          <Button size="sm" onClick={() => setAction('reopen')}>
            重开
          </Button>
        )}
        {canWrite && isEditableBug(bug.status) && (
          <Button size="sm" variant="outline" onClick={() => setEditOpen(true)}>
            编辑
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs text-muted-foreground">修复负责人</dt>
          <dd className="mt-1">{bug.fixOwner?.name ?? '未指定'}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">回归负责人</dt>
          <dd className="mt-1">{bug.regressionOwner?.name ?? '未指定'}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">关联需求</dt>
          <dd className="mt-1">
            {bug.linkedRequirements.length
              ? bug.linkedRequirements.map((item) => `#${item.number} ${item.title}`).join('；')
              : '无'}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">代码引用</dt>
          <dd className="mt-1">
            {bug.linkedCodeReferences.length
              ? bug.linkedCodeReferences.map((item) => (
                  <div key={item.id} className="flex items-center gap-2">
                    <span>{item.title || item.remoteId}</span>
                    <Badge variant={item.lastCheckStatus === 'ok' ? 'secondary' : 'destructive'}>
                      {item.lastCheckStatus}
                    </Badge>
                    <Button size="xs" variant="ghost" onClick={() => refreshCode.mutate(item.id)}>
                      刷新
                    </Button>
                  </div>
                ))
              : '无'}
          </dd>
          {canWrite && (
            <Button size="xs" variant="outline" className="mt-2" onClick={() => setCodeOpen(true)}>
              添加引用
            </Button>
          )}
        </div>
      </dl>
      {canWrite && (
        <div className="flex flex-wrap items-center gap-2">
          <Select
            className="min-w-56"
            aria-label="关联需求"
            value={linkRequirementId}
            onChange={(event) => setLinkRequirementId(event.target.value)}
          >
            <option value="">选择同项目需求</option>
            {(requirements.data?.data.items ?? [])
              .filter((item) => !bug.linkedRequirements.some((linked) => linked.id === item.id))
              .map((item) => (
                <option key={item.id} value={item.id}>
                  #{item.number} {item.title}
                </option>
              ))}
          </Select>
          <Button
            size="sm"
            variant="outline"
            disabled={!linkRequirementId || link.isPending}
            onClick={() => link.mutate()}
          >
            关联需求
          </Button>
        </div>
      )}
      <section className="space-y-2 text-sm">
        <h3 className="font-semibold">现象与预期</h3>
        <p className="whitespace-pre-wrap">{bug.phenomenon}</p>
        <p className="text-xs text-muted-foreground">预期：{bug.expectedBehavior}</p>
        {bug.reproduction && <p className="whitespace-pre-wrap text-muted-foreground">复现：{bug.reproduction}</p>}
        {bug.reproductionUnknown && <p className="text-muted-foreground">复现：明确无法稳定复现</p>}
      </section>
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">回归历史</h3>
        {bug.regressions.length ? (
          <ol className="space-y-2">
            {bug.regressions.map((item) => (
              <li key={item.id} className="rounded-lg border p-3 text-sm">
                <div className="flex justify-between gap-2">
                  <span>
                    第 {item.attempt} 次 · {REGRESSION_RESULT_LABELS[item.result] ?? item.result}
                  </span>
                  <span className="text-xs text-muted-foreground">{formatDateTime(item.createdAt)}</span>
                </div>
                <p className="mt-1 text-muted-foreground">{item.fixSummary}</p>
                {item.failureReason && <p className="mt-1 text-xs text-destructive">{item.failureReason}</p>}
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-sm text-muted-foreground">暂无回归记录。</p>
        )}
      </section>
      <Tabs defaultValue="comments">
        <TabsList>
          <TabsTrigger value="comments">评论</TabsTrigger>
          <TabsTrigger value="activities">活动</TabsTrigger>
        </TabsList>
        <TabsContent value="comments" className="space-y-4">
          <CommentList target="bug" targetId={bug.id} />
          <CommentForm target="bug" targetId={bug.id} disabled={!canWrite} />
        </TabsContent>
        <TabsContent value="activities">
          <ActivityTimeline target="bug" targetId={bug.id} />
        </TabsContent>
      </Tabs>
      <CodeReferenceDialog
        projectId={bug.projectId}
        targetType="bug"
        targetId={bug.id}
        open={codeOpen}
        onOpenChange={setCodeOpen}
      />
      <BugActionDialog
        bug={bug}
        action={action}
        teamId={bug.teamId}
        open={action !== null}
        onOpenChange={(open) => {
          if (!open) setAction(null)
        }}
      />
      <BugForm
        projectId={bug.projectId}
        teamId={bug.teamId}
        open={editOpen}
        onOpenChange={setEditOpen}
        bug={bug}
        onSaved={onClose}
      />
    </aside>
  )
}
