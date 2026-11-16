import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Pencil, Plus } from 'lucide-react'
import { DelayedLoading } from '@/shared/ui/delayed-loading'
import { Button } from '@/shared/ui/controls/button'
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
import { RemoteBugActions } from '@/features/tools/ui/remote-bug-actions'
import { useSession } from '@/features/identity/model/session'
import { describeRequestError } from '@/shared/api/errors'
import { formatDateTime } from '@/shared/lib/format'
import { PageError, PageLoading } from '@/shared/ui/page-state'
import { bugMutations, canWriteBugs, isBugScopeEditable } from '../api/mutations'
import { bugQueryOptions } from '../api/queries'
import { BUG_STATUS_LABELS, REGRESSION_RESULT_LABELS, bugStatusTone } from '../model/labels'
import { AttachmentList } from '@/features/attachments/ui/attachment-list'
import { describeAttachmentError } from '@/features/attachments/lib/errors'
import { removeAttachment } from '@/features/attachments/api/attachments-api'
import type { AttachmentSummary } from '@/features/attachments/model/types'
import { projectQueryOptions } from '@/features/projects/api/queries'
import { BugActionDialog, type BugAction } from './bug-action-dialog'
import { BugForm, type BugEditSection } from './bug-form'
import { BugWorkflow } from './bug-workflow'
import type { BugDetail } from '../model/types'

const DETAIL_TABS = [
  ['info', '基本信息'],
  ['nodes', '节点详情'],
  ['requirements', '关联需求'],
  ['comments', '评论'],
  ['activities', '操作记录'],
] as const

/**
 * 显示 Bug 的状态、流程、规划、基本信息和关联需求。
 * @param props Bug 标识及返回列表的回调。
 * @returns 可在详情内维护 Bug 和规划的侧栏。
 */
export function BugDetailPane({ bugId, onClose }: { bugId: string; onClose: () => void }) {
  const queryClient = useQueryClient()
  const { user, role } = useSession()
  const query = useQuery(bugQueryOptions(bugId))
  const project = useQuery({
    ...projectQueryOptions(query.data?.data.projectId ?? ''),
    enabled: Boolean(query.data?.data.projectId),
  })
  const [action, setAction] = useState<BugAction | null>(null)
  const [editor, setEditor] = useState<{ item: BugDetail; section: BugEditSection } | null>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const trigger = useRef<HTMLButtonElement | null>(null)
  const [attachmentError, setAttachmentError] = useState('')
  const canWrite = canWriteBugs(role)
  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ['bugs'] })
    await queryClient.invalidateQueries({ queryKey: ['projects'] })
  }
  const removeAttachmentMutation = useMutation({
    mutationFn: (attachment: AttachmentSummary) => removeAttachment(attachment.id),
    onSuccess: async () => {
      setAttachmentError('')
      await queryClient.invalidateQueries({ queryKey: ['bugs', 'detail', bugId] })
    },
    onError: (cause: unknown) => setAttachmentError(describeAttachmentError(cause)),
  })
  const startFix = useMutation({
    mutationFn: () => bugMutations.startFix(bugId, { version: query.data?.data.version ?? 0 }),
    onSuccess: invalidate,
  })
  if (query.isPending)
    return (
      <WorkItemDetailSheet label="Bug 详情" onClose={onClose}>
        <DelayedLoading pending>
          <PageLoading message="Bug 加载中…" />
        </DelayedLoading>
      </WorkItemDetailSheet>
    )
  if (query.isError) {
    const described = describeRequestError(query.error)
    return (
      <WorkItemDetailSheet label="Bug 详情" onClose={onClose}>
        <PageError
          title="Bug 加载失败"
          description={described.description}
          requestId={described.requestId}
          onRetry={() => void query.refetch()}
        />
      </WorkItemDetailSheet>
    )
  }
  const bug = query.data.data
  const scopeEditable = canWrite && isBugScopeEditable(bug.status)
  const range = workPlanRange(bug.plan ?? [])
  const openEdit = (section: BugEditSection, element: HTMLButtonElement) => {
    trigger.current = element
    setEditor({ item: bug, section })
  }
  const restoreFocus = (event: Event) => {
    const target = trigger.current?.isConnected ? trigger.current : heading.current
    if (!target) return
    event.preventDefault()
    target.focus({ preventScroll: true })
  }
  const saveOwner = (field: 'fixOwnerUserId' | 'regressionOwnerUserId', userId: string | null) =>
    saveWorkItemUpdate(queryClient, { kind: 'bug', id: bug.id, body: { version: bug.version, [field]: userId } })
  /**
   * 附件删除权限：上传者本人、团队管理员或项目负责人；浏览者不展示删除入口。
   * @param attachment 待删除附件。
   * @returns 当前用户是否可删除该附件。
   */
  const canDeleteAttachment = (attachment: AttachmentSummary) =>
    role !== 'viewer' &&
    (role === 'admin' || attachment.uploadedBy.userId === user.id || project.data?.data.owner.userId === user.id)
  return (
    <WorkItemDetailSheet
      label="Bug 详情"
      onClose={onClose}
      heading={
        <header className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">Bug #{bug.number}</p>
            <h2 ref={heading} tabIndex={-1} className="mt-1 text-lg font-semibold leading-6 wrap-anywhere">
              {bug.title}
            </h2>
            <div className="mt-2 flex flex-wrap gap-2">
              <StatusBadge tone={bugStatusTone(bug.status)}>{BUG_STATUS_LABELS[bug.status] ?? bug.status}</StatusBadge>
              <span className="text-xs text-muted-foreground">更新 {formatDateTime(bug.updatedAt)}</span>
              {range && <span className="text-xs text-muted-foreground">计划 {range.days} 天</span>}
            </div>
          </div>
          {canWrite && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="work-item-edit-button"
              onClick={(event) => openEdit('title', event.currentTarget)}
            >
              <Pencil aria-hidden="true" />
              编辑 Bug
            </Button>
          )}
        </header>
      }
    >
      <div className="work-item-detail-content space-y-5">
        <BugWorkflow
          bug={bug}
          canWrite={canWrite}
          isStarting={startFix.isPending}
          startError={startFix.isError ? describeRequestError(startFix.error).description : ''}
          onStart={() => startFix.mutate()}
          onOwnerChange={saveOwner}
          onAction={(next, element) => {
            trigger.current = element
            setAction(next)
          }}
        />
        <WorkItemDetailTabs label="Bug 详情分区" tabs={DETAIL_TABS}>
          <TabsContent value="info" className="space-y-5">
            <dl className="detail-properties">
              <WorkItemOwnerField
                teamId={bug.teamId}
                label="修复负责人"
                owner={bug.fixOwner}
                onSave={canWrite ? (id) => saveOwner('fixOwnerUserId', id) : undefined}
              />
              <WorkItemOwnerField
                teamId={bug.teamId}
                label="回归负责人"
                owner={bug.regressionOwner}
                onSave={
                  canWrite && bug.status !== 'in_regression'
                    ? (id) => saveOwner('regressionOwnerUserId', id)
                    : undefined
                }
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
                  <CollaboratorTags members={bug.collaborators} />
                </dd>
              </div>
            </dl>
            <section className="space-y-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-semibold">现象与预期</h3>
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
              <p className="whitespace-pre-wrap">{bug.phenomenon}</p>
              <p className="text-xs text-muted-foreground">预期：{bug.expectedBehavior}</p>
              {bug.reproduction && (
                <p className="whitespace-pre-wrap text-muted-foreground">复现：{bug.reproduction}</p>
              )}
              {bug.reproductionUnknown && <p className="text-muted-foreground">复现：明确无法稳定复现</p>}
              {bug.evidenceText || bug.evidenceUrl ? (
                <div className="space-y-1 pt-1">
                  <h3 className="font-semibold">证据</h3>
                  {bug.evidenceText ? <p className="whitespace-pre-wrap">{bug.evidenceText}</p> : null}
                  {bug.evidenceUrl ? (
                    <a className="text-primary underline" href={bug.evidenceUrl} target="_blank" rel="noreferrer">
                      查看外部证据
                    </a>
                  ) : null}
                </div>
              ) : null}
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
                attachments={bug.attachments ?? []}
                canDelete={canDeleteAttachment}
                onDelete={(attachment) => removeAttachmentMutation.mutate(attachment)}
                deletingId={
                  removeAttachmentMutation.isPending ? (removeAttachmentMutation.variables?.id ?? null) : null
                }
                deleteError={attachmentError}
              />
            </section>
            <WorkItemCodeReferences
              kind="bug"
              id={bug.id}
              projectId={bug.projectId}
              references={bug.linkedCodeReferences}
              canWrite={canWrite}
            />
            <RemoteBugActions projectId={bug.projectId} bugId={bug.id} canWrite={canWrite} />
          </TabsContent>
          <TabsContent value="nodes" className="space-y-5">
            <WorkItemPlanning
              kind="bug"
              status={bug.status}
              plan={bug.plan}
              canWrite={canWrite}
              onSave={(plan) =>
                saveWorkItemUpdate(queryClient, {
                  kind: 'bug',
                  id: bug.id,
                  body: { version: bug.version, plan },
                })
              }
            />
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
          </TabsContent>
          <TabsContent value="requirements">
            <WorkItemLinks
              source={{ kind: 'bug', id: bug.id, projectId: bug.projectId, version: bug.version }}
              items={bug.linkedRequirements}
              canWrite={canWrite}
            />
          </TabsContent>
          <TabsContent value="comments" className="space-y-4">
            <CommentList target="bug" targetId={bug.id} />
            <CommentForm target="bug" targetId={bug.id} disabled={!canWrite} />
          </TabsContent>
          <TabsContent value="activities">
            <ActivityTimeline target="bug" targetId={bug.id} />
          </TabsContent>
        </WorkItemDetailTabs>
      </div>
      <BugActionDialog
        bug={bug}
        action={action}
        teamId={bug.teamId}
        open={action !== null}
        onOpenChange={(open) => {
          if (!open) setAction(null)
        }}
        onCloseAutoFocus={restoreFocus}
      />
      {editor && (
        <BugForm
          projectId={bug.projectId}
          teamId={bug.teamId}
          currentUserId={user.id}
          open
          onOpenChange={(open) => !open && setEditor(null)}
          initialSection={editor.section}
          bug={editor.item}
          onCloseAutoFocus={restoreFocus}
        />
      )}
    </WorkItemDetailSheet>
  )
}
