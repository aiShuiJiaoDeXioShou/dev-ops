import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { isBusinessError } from '@dev-ops/api-client'
import { apiClient } from '@/shared/api/client'
import { DelayedLoading } from '@/shared/ui/delayed-loading'
import { Tag } from '@/shared/ui/tag'
import { Button } from '@/shared/ui/controls/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/controls/tabs'
import { StatusBadge } from '@/shared/ui/status-badge'
import { ActivityTimeline, CommentForm, CommentList } from '@/features/collaboration/public'
import { CodeReferenceCard, CodeReferenceDialog } from '@/features/code/public'
import { BugForm } from '@/features/bugs/public'
import {
  AttachmentList,
  describeAttachmentError,
  removeAttachment,
  type AttachmentSummary,
} from '@/features/attachments/public'
import { useSession } from '@/features/identity/public'
import { projectQueryOptions } from '@/features/projects/public'
import { describeRequestError } from '@/shared/api/errors'
import { formatDateTime } from '@/shared/lib/format'
import { Markdown } from '@/shared/lib/markdown'
import { PageError, PageLoading } from '@/shared/ui/page-state'
import { eligibilityQueryOptions, requirementQueryOptions, submissionQueryOptions } from '../api/queries'
import { canWriteRequirements, isEditable, requirementMutations } from '../api/mutations'
import { avatarToneClassName } from '@/shared/lib/avatar-tone'
import { cn } from '@/shared/lib/utils'
import { REQUIREMENT_STATUS_LABELS, SELF_TEST_LABELS, requirementStatusTone } from '../model/labels'
import type { RequirementDetail } from '../model/types'
import { RequirementActionDialog, type RequirementAction } from './requirement-action-dialog'
import { RequirementForm } from './requirement-form'

/** 需求协作人员展示标签；失效成员保留并标注，不从历史数据中静默丢弃。 */
function CollaboratorTags({ members }: { members: RequirementDetail['collaborators'] }) {
  if (members.length === 0) return <span>无</span>
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="协作人员">
      {members.map((member) => (
        <li
          key={member.userId}
          className={cn(
            'inline-flex items-center gap-1 rounded-full border py-0.5 pr-2 pl-0.5 text-xs',
            member.available
              ? 'border-border bg-secondary text-secondary-foreground'
              : 'border-destructive/40 bg-destructive/10 text-destructive',
          )}
        >
          <span
            aria-hidden="true"
            className={cn(
              'grid size-5 shrink-0 place-items-center rounded-full text-xs font-medium',
              avatarToneClassName(member.userId),
            )}
          >
            {member.name.slice(0, 1)}
          </span>
          <span className="max-w-40 truncate">{member.name}</span>
          {!member.available && <span className="shrink-0">已失效</span>}
        </li>
      ))}
    </ul>
  )
}

/** 需求详情：范围字段、关联、流程动作、评论与活动。 */
export function RequirementDetailPane({ requirementId, onClose }: { requirementId: string; onClose: () => void }) {
  const queryClient = useQueryClient()
  const { user, role } = useSession()
  const query = useQuery(requirementQueryOptions(requirementId))
  const project = useQuery({
    ...projectQueryOptions(query.data?.data.projectId ?? ''),
    enabled: Boolean(query.data?.data.projectId),
  })
  const submissions = useQuery(submissionQueryOptions(requirementId))
  const eligibility = useQuery({
    ...eligibilityQueryOptions(requirementId),
    enabled: query.data?.data.status === 'in_testing',
  })
  const [action, setAction] = useState<RequirementAction | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [error, setError] = useState('')
  const [attachmentError, setAttachmentError] = useState('')
  const [codeOpen, setCodeOpen] = useState(false)
  const [bugOpen, setBugOpen] = useState(false)
  const canWrite = canWriteRequirements(role)
  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ['requirements'] })
    await queryClient.invalidateQueries({ queryKey: ['projects'] })
  }
  const refreshCode = useMutation({
    mutationFn: (codeReferenceId: string) => apiClient.refreshCodeReference(codeReferenceId),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ['requirements', 'detail', requirementId] }),
    onError: (cause: unknown) => setError(isBusinessError(cause) ? cause.message : '代码引用刷新失败。'),
  })
  const removeAttachmentMutation = useMutation({
    mutationFn: (attachment: AttachmentSummary) => removeAttachment(attachment.id),
    onSuccess: async () => {
      setAttachmentError('')
      await queryClient.invalidateQueries({ queryKey: ['requirements', 'detail', requirementId] })
    },
    onError: (cause: unknown) => setAttachmentError(describeAttachmentError(cause)),
  })
  const direct = useMutation({
    mutationFn: async (kind: 'start-development' | 'start-test') => {
      const version = query.data?.data.version ?? 0
      return kind === 'start-development'
        ? requirementMutations.startDevelopment(requirementId, { version })
        : requirementMutations.startTest(requirementId, { version })
    },
    onSuccess: invalidate,
    onError: (cause: unknown) => setError(isBusinessError(cause) ? cause.message : '状态更新失败。'),
  })
  if (query.isPending)
    return (
      <aside className="details" aria-label="需求详情">
        <div className="detail-scroll">
          <DelayedLoading pending>
            <PageLoading message="需求加载中…" />
          </DelayedLoading>
        </div>
      </aside>
    )
  if (query.isError) {
    const described = describeRequestError(query.error)
    return (
      <aside className="details" aria-label="需求详情">
        <div className="detail-scroll">
          <PageError
            title="需求加载失败"
            description={described.description}
            requestId={described.requestId}
            onRetry={() => void query.refetch()}
          />
        </div>
      </aside>
    )
  }
  const detail = query.data.data
  const editable = canWrite && isEditable(detail.status)
  /**
   * 附件删除权限：上传者本人、团队管理员或项目负责人；浏览者与无权限成员不展示删除入口。
   * @param attachment 待删除附件。
   * @returns 当前用户是否可删除该附件。
   */
  const canDeleteAttachment = (attachment: AttachmentSummary) =>
    role === 'admin' || attachment.uploadedBy.userId === user.id || project.data?.data.owner.userId === user.id
  const blockers = eligibility.data?.data.blockers ?? []
  return (
    <aside className="details" aria-label="需求详情">
      <div className="detail-top">
        <span className="detail-top-title">需求详情</span>
        <span className="spacer" />
        <Button variant="ghost" size="sm" onClick={onClose}>
          返回列表
        </Button>
      </div>
      <div className="detail-scroll">
        <div className="space-y-5">
          <header className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs text-muted-foreground">需求 #{detail.number}</p>
              <h2 className="mt-1 text-lg font-semibold leading-6">{detail.title}</h2>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <StatusBadge tone={requirementStatusTone(detail.status)}>
                  {REQUIREMENT_STATUS_LABELS[detail.status] ?? detail.status}
                </StatusBadge>
                <span>更新 {formatDateTime(detail.updatedAt)}</span>
                {detail.needsReview && <Tag variant="red">存在未解决 Bug，需复核</Tag>}
              </div>
            </div>
          </header>
          {detail.status === 'in_testing' && (
            <div
              className={
                blockers.length ? 'rounded-lg bg-destructive/10 p-3 text-sm' : 'rounded-lg bg-success/10 p-3 text-sm'
              }
            >
              {blockers.length ? (
                <>未解决 Bug：{blockers.map((bug) => `#${bug.number} ${bug.title}`).join('；')}</>
              ) : (
                '关联 Bug 均已解决或关闭，可以测试通过。'
              )}
            </div>
          )}
          <div className="detail-actions">
            {canWrite && detail.status === 'pending' && (
              <Button size="sm" onClick={() => direct.mutate('start-development')} disabled={direct.isPending}>
                开始开发
              </Button>
            )}
            {canWrite && detail.status === 'in_development' && (
              <Button size="sm" onClick={() => setAction('submit-test')}>
                提测
              </Button>
            )}
            {canWrite && detail.status === 'submitted' && (
              <Button size="sm" onClick={() => direct.mutate('start-test')} disabled={direct.isPending}>
                开始测试
              </Button>
            )}
            {canWrite && detail.status === 'submitted' && (
              <Button size="sm" variant="outline" onClick={() => setAction('withdraw-test')}>
                撤回测试
              </Button>
            )}
            {canWrite && detail.status === 'in_testing' && (
              <Button size="sm" onClick={() => setAction('return-to-development')}>
                退回开发
              </Button>
            )}
            {canWrite && detail.status === 'in_testing' && (
              <Button size="sm" onClick={() => setAction('pass-test')} disabled={blockers.length > 0}>
                测试通过
              </Button>
            )}
            {canWrite && detail.status === 'passed' && (
              <Button size="sm" onClick={() => setAction('reopen-development')}>
                重新开发
              </Button>
            )}
            {canWrite && ['pending', 'in_development', 'submitted', 'in_testing', 'passed'].includes(detail.status) && (
              <Button size="sm" variant="outline" onClick={() => setAction('cancel')}>
                取消
              </Button>
            )}
            {canWrite && detail.status === 'cancelled' && (
              <Button size="sm" onClick={() => setAction('restore')}>
                恢复
              </Button>
            )}
            {editable && (
              <Button size="sm" variant="outline" onClick={() => setEditOpen(true)}>
                编辑
              </Button>
            )}
            {canWrite && (
              <Button size="sm" variant="outline" onClick={() => setBugOpen(true)}>
                创建 Bug
              </Button>
            )}
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <dl className="detail-properties">
            <div>
              <dt className="text-xs text-muted-foreground">研发负责人</dt>
              <dd className="mt-1">{detail.devOwner?.name ?? '未指定'}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">测试负责人</dt>
              <dd className="mt-1">{detail.testOwner?.name ?? '未指定'}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">协作人员</dt>
              <dd className="mt-1">
                <CollaboratorTags members={detail.collaborators} />
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">关联 Bug</dt>
              <dd className="mt-1">
                {detail.linkedBugs.length
                  ? detail.linkedBugs.map((bug) => `#${bug.number} ${bug.title}`).join('；')
                  : '无'}
              </dd>
            </div>
          </dl>
          <section className="space-y-2">
            <h3 className="text-sm font-semibold">内容</h3>
            {detail.contentMode === 'markdown' ? (
              <div className="detail-markdown text-sm">
                <Markdown>{detail.contentMarkdown ?? ''}</Markdown>
              </div>
            ) : (
              <a
                className="text-sm text-primary hover:underline"
                href={detail.externalUrl ?? '#'}
                target="_blank"
                rel="noreferrer"
              >
                打开外部文档
              </a>
            )}
            {detail.externalSummary && <p className="text-sm text-muted-foreground">{detail.externalSummary}</p>}
            {detail.acceptanceCriteria && (
              <div className="text-sm">
                <p className="text-xs text-muted-foreground">验收标准</p>
                <p className="mt-1 whitespace-pre-wrap">{detail.acceptanceCriteria}</p>
              </div>
            )}
          </section>
          <section className="space-y-2" aria-label="附件">
            <h3 className="text-sm font-semibold">附件</h3>
            <AttachmentList
              attachments={detail.attachments ?? []}
              canDelete={canDeleteAttachment}
              onDelete={(attachment) => removeAttachmentMutation.mutate(attachment)}
              deletingId={removeAttachmentMutation.isPending ? (removeAttachmentMutation.variables?.id ?? null) : null}
              deleteError={attachmentError}
            />
          </section>
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">代码引用</h3>
              {canWrite && (
                <Button size="sm" variant="outline" onClick={() => setCodeOpen(true)}>
                  添加引用
                </Button>
              )}
            </div>
            {detail.linkedCodeReferences.length === 0 ? (
              <p className="text-sm text-muted-foreground">暂无代码引用。</p>
            ) : (
              <ul className="space-y-2">
                {detail.linkedCodeReferences.map((reference) => (
                  <CodeReferenceCard
                    key={reference.id}
                    reference={reference}
                    onRefresh={() => refreshCode.mutate(reference.id)}
                    refreshing={refreshCode.isPending}
                  />
                ))}
              </ul>
            )}
          </section>
          <Tabs defaultValue="comments">
            <TabsList>
              <TabsTrigger value="comments">评论</TabsTrigger>
              <TabsTrigger value="activities">活动</TabsTrigger>
              <TabsTrigger value="submissions">提测历史</TabsTrigger>
            </TabsList>
            <TabsContent value="comments" className="space-y-4">
              <CommentList target="requirement" targetId={detail.id} />
              <CommentForm target="requirement" targetId={detail.id} disabled={!canWrite} />
            </TabsContent>
            <TabsContent value="activities">
              <ActivityTimeline target="requirement" targetId={detail.id} />
            </TabsContent>
            <TabsContent value="submissions">
              {submissions.data?.data.items.length ? (
                <ul className="space-y-3">
                  {submissions.data.data.items.map((item) => (
                    <li key={item.id} className="rounded-lg border p-3 text-sm">
                      <p className="text-xs text-muted-foreground">
                        {formatDateTime(item.createdAt)} · 自测{' '}
                        {SELF_TEST_LABELS[item.selfTestResult] ?? item.selfTestResult}
                      </p>
                      <p className="mt-1">{item.scopeNote}</p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">暂无提测记录。</p>
              )}
            </TabsContent>
          </Tabs>
          <BugForm
            projectId={detail.projectId}
            teamId={detail.teamId}
            requirementId={detail.id}
            open={bugOpen}
            onOpenChange={setBugOpen}
            onSaved={() => void query.refetch()}
          />
          <CodeReferenceDialog
            projectId={detail.projectId}
            targetType="requirement"
            targetId={detail.id}
            open={codeOpen}
            onOpenChange={setCodeOpen}
          />
        </div>
      </div>
      <RequirementActionDialog
        requirement={detail}
        action={action}
        teamId={detail.teamId}
        open={action !== null}
        onOpenChange={(open) => {
          if (!open) setAction(null)
        }}
      />
      <RequirementForm
        projectId={detail.projectId}
        teamId={detail.teamId}
        open={editOpen}
        onOpenChange={setEditOpen}
        requirement={detail}
        onSaved={onClose}
      />
    </aside>
  )
}
