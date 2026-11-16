import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { isBusinessError } from '@dev-ops/api-client'
import { Ellipsis } from 'lucide-react'
import { apiClient } from '@/shared/api/client'
import { DelayedLoading } from '@/shared/ui/delayed-loading'
import { Button } from '@/shared/ui/controls/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/ui/controls/dropdown-menu'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/controls/tabs'
import { WorkItemDetailSheet } from '@/shared/ui/controls/work-item-detail-sheet'
import { StatusBadge } from '@/shared/ui/status-badge'
import { ActivityTimeline } from '@/features/collaboration/ui/activity-timeline'
import { CommentForm } from '@/features/collaboration/ui/comment-form'
import { CollaboratorTags } from '@/features/collaboration/ui/collaborator-tags'
import { CommentList } from '@/features/collaboration/ui/comment-list'
import { WorkItemLinks } from '@/features/collaboration/ui/work-item-links'
import { CodeReferenceCard } from '@/features/code/ui/code-reference-card'
import { CodeReferenceDialog } from '@/features/code/ui/code-reference-dialog'
import { BugForm } from '@/features/bugs/ui/bug-form'
import { AttachmentList } from '@/features/attachments/ui/attachment-list'
import { describeAttachmentError } from '@/features/attachments/lib/errors'
import { removeAttachment } from '@/features/attachments/api/attachments-api'
import type { AttachmentSummary } from '@/features/attachments/model/types'
import { useSession } from '@/features/identity/model/session'
import { projectQueryOptions } from '@/features/projects/api/queries'
import { describeRequestError } from '@/shared/api/errors'
import { formatDateTime } from '@/shared/lib/format'
import { Markdown } from '@/shared/lib/markdown'
import { PageError, PageLoading } from '@/shared/ui/page-state'
import { requirementQueryOptions, submissionQueryOptions } from '../api/queries'
import { canWriteRequirements, isEditable, requirementMutations } from '../api/mutations'
import { REQUIREMENT_STATUS_LABELS, SELF_TEST_LABELS, requirementStatusTone } from '../model/labels'
import { RequirementActionDialog, type RequirementAction } from './requirement-action-dialog'
import { RequirementForm } from './requirement-form'
import { RequirementWorkflow } from './requirement-workflow'

const DETAIL_TABS = [
  ['info', '基本信息'],
  ['submissions', '节点详情'],
  ['bugs', '缺陷管理'],
  ['comments', '评论'],
  ['activities', '操作记录'],
] as const

/**
 * 展示需求的状态、流程节点、基本信息和协作记录。
 * @param props 需求 ID 及返回列表的回调。
 * @returns 可展开的需求详情浮层，写操作按角色与状态显示。
 */
export function RequirementDetailPane({ requirementId, onClose }: { requirementId: string; onClose: () => void }) {
  const queryClient = useQueryClient()
  const { user, role } = useSession()
  const query = useQuery(requirementQueryOptions(requirementId))
  const project = useQuery({
    ...projectQueryOptions(query.data?.data.projectId ?? ''),
    enabled: Boolean(query.data?.data.projectId),
  })
  const submissions = useQuery(submissionQueryOptions(requirementId))
  const [action, setAction] = useState<RequirementAction | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [error, setError] = useState('')
  const [attachmentError, setAttachmentError] = useState('')
  const [codeOpen, setCodeOpen] = useState(false)
  const [bugOpen, setBugOpen] = useState(false)
  const heading = useRef<HTMLHeadingElement>(null)
  const detailMenu = useRef<HTMLButtonElement>(null)
  const actionTrigger = useRef<HTMLButtonElement | null>(null)
  const canWrite = canWriteRequirements(role)
  const openAction = (nextAction: RequirementAction, trigger: HTMLButtonElement | null) => {
    actionTrigger.current = trigger
    setAction(nextAction)
  }
  const restoreActionFocus = (event: Event) => {
    const trigger = actionTrigger.current
    const target = trigger?.isConnected ? trigger : heading.current
    if (!target) return
    event.preventDefault()
    target.focus({ preventScroll: true })
  }
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
  })
  if (query.isPending)
    return (
      <WorkItemDetailSheet label="需求详情" onClose={onClose}>
        <DelayedLoading pending>
          <PageLoading message="需求加载中…" />
        </DelayedLoading>
      </WorkItemDetailSheet>
    )
  if (query.isError) {
    const described = describeRequestError(query.error)
    return (
      <WorkItemDetailSheet label="需求详情" onClose={onClose}>
        <PageError
          title="需求加载失败"
          description={described.description}
          requestId={described.requestId}
          onRetry={() => void query.refetch()}
        />
      </WorkItemDetailSheet>
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
    role !== 'viewer' &&
    (role === 'admin' || attachment.uploadedBy.userId === user.id || project.data?.data.owner.userId === user.id)
  return (
    <WorkItemDetailSheet
      label="需求详情"
      onClose={onClose}
      heading={
        <header className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">需求 #{detail.number}</p>
            <h2 ref={heading} tabIndex={-1} className="mt-1 text-lg leading-6 font-semibold wrap-anywhere">
              {detail.title}
            </h2>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <StatusBadge tone={requirementStatusTone(detail.status)}>
                {REQUIREMENT_STATUS_LABELS[detail.status] ?? detail.status}
              </StatusBadge>
              <span>更新 {formatDateTime(detail.updatedAt)}</span>
            </div>
          </div>
          {canWrite && (
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <Button
                  ref={detailMenu}
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="requirement-more-button"
                  aria-label="更多需求操作"
                >
                  <Ellipsis aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {editable && (
                  <DropdownMenuItem
                    onSelect={() => {
                      actionTrigger.current = detailMenu.current
                      setEditOpen(true)
                    }}
                  >
                    编辑需求
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onSelect={() => setBugOpen(true)}>创建 Bug</DropdownMenuItem>
                {detail.status !== 'cancelled' && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-destructive"
                      onSelect={() => openAction('cancel', detailMenu.current)}
                    >
                      取消需求
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </header>
      }
    >
      <div className="requirement-detail-content space-y-5">
        <RequirementWorkflow
          requirement={detail}
          canWrite={canWrite}
          isStarting={direct.isPending}
          startError={direct.isError ? describeRequestError(direct.error).description : ''}
          onStart={(kind) => direct.mutate(kind)}
          onAction={openAction}
        />
        <Tabs defaultValue="info">
          <TabsList
            aria-label="需求详情分区"
            className="requirement-detail-tabs flex w-full justify-start gap-2 overflow-x-auto rounded-none border-b border-border bg-transparent p-0 sm:gap-3"
          >
            {DETAIL_TABS.map(([value, label]) => (
              <TabsTrigger
                key={value}
                value={value}
                className="min-h-10 shrink-0 rounded-none border-b-2 border-transparent px-1.5 text-xs focus-visible:ring-inset aria-selected:border-primary aria-selected:bg-transparent! aria-selected:text-primary! aria-selected:shadow-none! sm:px-3 sm:text-sm"
              >
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value="info" className="space-y-5">
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
            </dl>
            <section className="space-y-2">
              <h3 className="text-sm font-semibold">需求描述</h3>
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
                deletingId={
                  removeAttachmentMutation.isPending ? (removeAttachmentMutation.variables?.id ?? null) : null
                }
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
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
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
          </TabsContent>
          <TabsContent value="bugs">
            <WorkItemLinks
              source={{ kind: 'requirement', id: detail.id, projectId: detail.projectId }}
              items={detail.linkedBugs}
              canWrite={canWrite}
            />
          </TabsContent>
          <TabsContent value="comments" className="space-y-4">
            <CommentList target="requirement" targetId={detail.id} />
            <CommentForm target="requirement" targetId={detail.id} disabled={!canWrite} />
          </TabsContent>
          <TabsContent value="activities">
            <ActivityTimeline target="requirement" targetId={detail.id} />
          </TabsContent>
          <TabsContent value="submissions">
            <h3 className="mb-3 text-sm font-semibold">提测历史</h3>
            {submissions.isPending ? (
              <DelayedLoading pending>
                <PageLoading message="提测记录加载中…" />
              </DelayedLoading>
            ) : submissions.isError ? (
              <PageError
                title="提测记录加载失败"
                description={describeRequestError(submissions.error).description}
                onRetry={() => void submissions.refetch()}
              />
            ) : submissions.data.data.items.length ? (
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
          currentUserId={user.id}
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
      <RequirementActionDialog
        requirement={detail}
        action={action}
        teamId={detail.teamId}
        open={action !== null}
        onOpenChange={(open) => {
          if (!open) setAction(null)
        }}
        onCloseAutoFocus={restoreActionFocus}
      />
      <RequirementForm
        projectId={detail.projectId}
        teamId={detail.teamId}
        currentUserId={user.id}
        open={editOpen}
        onOpenChange={setEditOpen}
        requirement={detail}
        onSaved={onClose}
        onCloseAutoFocus={restoreActionFocus}
      />
    </WorkItemDetailSheet>
  )
}
