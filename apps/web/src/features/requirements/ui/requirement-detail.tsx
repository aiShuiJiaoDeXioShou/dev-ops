import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Ellipsis, Pencil, Plus } from 'lucide-react'
import { DelayedLoading } from '@/shared/ui/delayed-loading'
import { Button } from '@/shared/ui/controls/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/ui/controls/dropdown-menu'
import { TabsContent } from '@/shared/ui/controls/tabs'
import { WorkItemDetailSheet } from '@/shared/ui/controls/work-item-detail-sheet'
import { StatusBadge } from '@/shared/ui/status-badge'
import { ActivityTimeline } from '@/features/collaboration/ui/activity-timeline'
import { CommentForm } from '@/features/collaboration/ui/comment-form'
import { CollaboratorTags } from '@/features/collaboration/ui/collaborator-tags'
import { CommentList } from '@/features/collaboration/ui/comment-list'
import { WorkItemLinks } from '@/features/collaboration/ui/work-item-links'
import { WorkItemCodeReferences } from '@/features/code/ui/code-reference-card'
import { WorkItemOwnerField } from '@/features/collaboration/ui/work-item-owner-field'
import { WorkItemDetailTabs } from '@/features/collaboration/ui/work-item-detail-tabs'
import { WorkItemPlanning } from '@/features/collaboration/ui/work-item-planning'
import { saveWorkItemUpdate } from '@/features/collaboration/api/work-item-update'
import { workPlanRange } from '@/features/collaboration/model/work-item-plan'
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
import { canWriteRequirements, isRequirementScopeEditable, requirementMutations } from '../api/mutations'
import { REQUIREMENT_STATUS_LABELS, SELF_TEST_LABELS, requirementStatusTone } from '../model/labels'
import { RequirementActionDialog, type RequirementAction } from './requirement-action-dialog'
import { RequirementForm, type RequirementEditSection } from './requirement-form'
import type { RequirementDetail } from '../model/types'
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
  const [editor, setEditor] = useState<{ item: RequirementDetail; section: RequirementEditSection } | null>(null)
  const [attachmentError, setAttachmentError] = useState('')
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
  const scopeEditable = canWrite && isRequirementScopeEditable(detail.status)
  const range = workPlanRange(detail.plan ?? [])
  const openEdit = (section: RequirementEditSection, trigger: HTMLButtonElement) => {
    actionTrigger.current = trigger
    setEditor({ item: detail, section })
  }
  const saveOwner = (field: 'devOwnerUserId' | 'testOwnerUserId', userId: string | null) =>
    saveWorkItemUpdate(queryClient, {
      kind: 'requirement',
      id: detail.id,
      body: { version: detail.version, [field]: userId },
    })
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
              {range && <span>计划 {range.days} 天</span>}
            </div>
          </div>
          {canWrite && (
            <div className="flex shrink-0 items-center gap-1">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="work-item-edit-button"
                onClick={(event) => openEdit('title', event.currentTarget)}
              >
                <Pencil aria-hidden="true" />
                编辑需求
              </Button>
              <DropdownMenu modal={false}>
                <DropdownMenuTrigger asChild>
                  <Button
                    ref={detailMenu}
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="work-item-icon-button"
                    aria-label="更多需求操作"
                  >
                    <Ellipsis aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
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
            </div>
          )}
        </header>
      }
    >
      <div className="work-item-detail-content space-y-5">
        <RequirementWorkflow
          requirement={detail}
          canWrite={canWrite}
          isStarting={direct.isPending}
          startError={direct.isError ? describeRequestError(direct.error).description : ''}
          onStart={(kind) => direct.mutate(kind)}
          onAction={openAction}
          onOwnerChange={saveOwner}
        />
        <WorkItemDetailTabs label="需求详情分区" tabs={DETAIL_TABS}>
          <TabsContent value="info" className="space-y-5">
            <dl className="detail-properties">
              <WorkItemOwnerField
                teamId={detail.teamId}
                label="研发负责人"
                owner={detail.devOwner}
                onSave={canWrite ? (id) => saveOwner('devOwnerUserId', id) : undefined}
              />
              <WorkItemOwnerField
                teamId={detail.teamId}
                label="测试负责人"
                owner={detail.testOwner}
                onSave={canWrite ? (id) => saveOwner('testOwnerUserId', id) : undefined}
              />
              <div className="sm:col-span-2">
                <dt className="flex items-center justify-between gap-2">
                  <span>协作人员</span>
                  {canWrite && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="work-item-edit-button"
                      onClick={(event) => openEdit('people', event.currentTarget)}
                    >
                      <Pencil aria-hidden="true" />
                      编辑协作人员
                    </Button>
                  )}
                </dt>
                <dd className="mt-1">
                  <CollaboratorTags members={detail.collaborators} />
                </dd>
              </div>
            </dl>
            <section className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">需求描述</h3>
                {scopeEditable && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="work-item-edit-button"
                    onClick={(event) => openEdit('content', event.currentTarget)}
                  >
                    <Pencil aria-hidden="true" />
                    编辑描述
                  </Button>
                )}
              </div>
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
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">附件</h3>
                {scopeEditable && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="work-item-edit-button"
                    onClick={(event) => openEdit('attachments', event.currentTarget)}
                  >
                    <Plus aria-hidden="true" />
                    添加附件
                  </Button>
                )}
              </div>
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
            <WorkItemCodeReferences
              kind="requirement"
              id={detail.id}
              projectId={detail.projectId}
              references={detail.linkedCodeReferences}
              canWrite={canWrite}
            />
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
          <TabsContent value="submissions" className="space-y-5">
            <WorkItemPlanning
              kind="requirement"
              status={detail.status}
              plan={detail.plan}
              canWrite={canWrite}
              onSave={(plan) =>
                saveWorkItemUpdate(queryClient, {
                  kind: 'requirement',
                  id: detail.id,
                  body: { version: detail.version, plan },
                })
              }
            />
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
        </WorkItemDetailTabs>
        <BugForm
          projectId={detail.projectId}
          teamId={detail.teamId}
          currentUserId={user.id}
          requirementId={detail.id}
          open={bugOpen}
          onOpenChange={setBugOpen}
          onSaved={() => void query.refetch()}
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
      {editor && (
        <RequirementForm
          projectId={detail.projectId}
          teamId={detail.teamId}
          currentUserId={user.id}
          open
          onOpenChange={(open) => !open && setEditor(null)}
          requirement={editor.item}
          initialSection={editor.section}
          onCloseAutoFocus={restoreActionFocus}
        />
      )}
    </WorkItemDetailSheet>
  )
}
