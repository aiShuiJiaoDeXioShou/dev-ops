import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { describeRequestError } from '@/shared/api/errors'
import { createIdempotencyKey, isBusinessError, type ApiBody } from '@dev-ops/api-client'
import { apiClient } from '@/shared/api/client'
import { useToast } from '@/shared/ui/toast'
import { Button } from '@/shared/ui/controls/button'
import {
  Dialog,
  DialogContent,
  DialogFormBody,
  DialogFormFooter,
  DialogFormHeader,
  DialogTitle,
} from '@/shared/ui/controls/dialog'
import { FormField, FormGrid, FormSection } from '@/shared/ui/controls/form-field'
import { Input } from '@/shared/ui/controls/input'
import { MemberMultiSelect, type MemberSelectionDetail } from '@/shared/ui/controls/member-multiselect'
import { MemberSelect } from '@/shared/ui/controls/member-select'
import { Select } from '@/shared/ui/controls/select'
import { Textarea } from '@/shared/ui/controls/textarea'
import { toMemberOption } from '@/features/identity/model/team-member'
import { teamMembersQueryOptions } from '@/features/identity/api/team-queries'
import { AttachmentField } from '@/features/attachments/ui/attachment-field'
import { describeAttachmentError } from '@/features/attachments/lib/errors'
import { doneAttachmentIds, hasUnfinishedAttachments, toPendingAttachments } from '@/features/attachments/lib/pending'
import type { PendingAttachment } from '@/features/attachments/model/types'
import type { RequirementDetail } from '../model/types'
import { REQUIREMENT_STATUS_LABELS } from '../model/labels'

type CreateBody = ApiBody<'/api/v1/projects/{projectId}/requirements', 'post'>
type UpdateBody = ApiBody<'/api/v1/requirements/{requirementId}/update', 'post'>

interface RequirementFormProps {
  projectId: string
  teamId: string
  currentUserId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onCloseAutoFocus?: (event: Event) => void
  requirement?: RequirementDetail | null
  onSaved?: (requirementId: string) => void
}

/** 需求表单的字段级错误；键名与字段一一对应，便于定位首个错误。 */
interface RequirementFieldErrors {
  title?: string
  contentMarkdown?: string
  externalUrl?: string
}

/**
 * 滚动到首个错误字段并聚焦；优先保证窄屏和长表单下错误可见。
 * @param target 首个错误对应的可聚焦控件。
 */
function focusField(target: HTMLElement | null) {
  target?.scrollIntoView?.({ block: 'center' })
  target?.focus()
}

/**
 * 渲染需求创建和编辑表单，负责人选择随表单一起保存。
 * @param props 项目、团队、当前用户、待编辑需求与弹窗回调。
 * @returns 需求表单弹窗；保存失败时保留草稿。
 */
export function RequirementForm({
  projectId,
  teamId,
  currentUserId,
  open,
  onOpenChange,
  onCloseAutoFocus,
  requirement,
  onSaved,
}: RequirementFormProps) {
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const members = useQuery(teamMembersQueryOptions(teamId))
  const [title, setTitle] = useState('')
  const [contentMode, setContentMode] = useState<'markdown' | 'external_link'>('markdown')
  const [contentMarkdown, setContentMarkdown] = useState('')
  const [externalUrl, setExternalUrl] = useState('')
  const [externalSummary, setExternalSummary] = useState('')
  const [acceptanceCriteria, setAcceptanceCriteria] = useState('')
  const [devOwnerUserId, setDevOwnerUserId] = useState('')
  const [testOwnerUserId, setTestOwnerUserId] = useState('')
  const [collaboratorUserIds, setCollaboratorUserIds] = useState<string[]>([])
  const [attachments, setAttachments] = useState<PendingAttachment[]>([])
  const [attachmentError, setAttachmentError] = useState('')
  const [fieldErrors, setFieldErrors] = useState<RequirementFieldErrors>({})
  const [error, setError] = useState('')
  const [formBody, setFormBody] = useState<HTMLDivElement | null>(null)
  const titleRef = useRef<HTMLInputElement>(null)
  const contentRef = useRef<HTMLTextAreaElement>(null)
  const externalUrlRef = useRef<HTMLInputElement>(null)
  const collaboratorLabelId = useId()
  const collaboratorMessageId = useId()

  useEffect(() => {
    if (!open) return
    setTitle(requirement?.title ?? '')
    setContentMode(requirement?.contentMode ?? 'markdown')
    setContentMarkdown(requirement?.contentMarkdown ?? '')
    setExternalUrl(requirement?.externalUrl ?? '')
    setExternalSummary(requirement?.externalSummary ?? '')
    setAcceptanceCriteria(requirement?.acceptanceCriteria ?? '')
    setDevOwnerUserId(requirement?.devOwner?.userId ?? '')
    setTestOwnerUserId(requirement?.testOwner?.userId ?? '')
    setCollaboratorUserIds(requirement?.collaborators.map((item) => item.userId) ?? [])
    setAttachments(toPendingAttachments(requirement?.attachments ?? []))
    setAttachmentError('')
    setFieldErrors({})
    setError('')
  }, [open, requirement])

  const mutation = useMutation({
    mutationFn: async () => {
      const base = {
        title: title.trim(),
        contentMode,
        acceptanceCriteria: acceptanceCriteria.trim() || null,
        devOwnerUserId: devOwnerUserId || null,
        testOwnerUserId: testOwnerUserId || null,
        collaboratorUserIds,
        attachmentIds: doneAttachmentIds(attachments),
        ...(contentMode === 'markdown'
          ? { contentMarkdown: contentMarkdown.trim(), externalUrl: null, externalSummary: null }
          : {
              externalUrl: externalUrl.trim(),
              externalSummary: externalSummary.trim() || null,
              contentMarkdown: null,
            }),
      }
      if (requirement) {
        return apiClient.updateRequirement(requirement.id, { ...base, version: requirement.version } as UpdateBody)
      }
      return apiClient.createRequirement(projectId, base as CreateBody, { idempotencyKey: createIdempotencyKey() })
    },
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ['requirements'] })
      await queryClient.invalidateQueries({ queryKey: ['projects'] })
      onOpenChange(false)
      onSaved?.(result.data.id)
    },
    onError: (cause: unknown) => {
      const message = isBusinessError(cause) ? describeAttachmentError(cause) : '保存失败，请稍后重试。'
      setError(message)
      showToast(message, 'error')
    },
  })

  /**
   * 本地校验并按表单顺序定位首个错误字段；字段错误就地展示，不再重复全局提示。
   * @param event 表单提交事件。
   */
  const submit = (event: FormEvent) => {
    event.preventDefault()
    setError('')
    const nextErrors: RequirementFieldErrors = {}
    let firstTarget: HTMLElement | null = null
    if (!title.trim()) {
      nextErrors.title = '请填写需求标题。'
      firstTarget = titleRef.current
    }
    if (contentMode === 'markdown' && !contentMarkdown.trim()) {
      nextErrors.contentMarkdown = '请填写需求正文。'
      firstTarget ??= contentRef.current
    }
    if (contentMode === 'external_link' && !/^https?:\/\//.test(externalUrl.trim())) {
      nextErrors.externalUrl = '外部链接必须是 HTTP/HTTPS 地址。'
      firstTarget ??= externalUrlRef.current
    }
    setFieldErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) {
      focusField(firstTarget)
      return
    }
    if (hasUnfinishedAttachments(attachments)) {
      setAttachmentError('附件未全部上传完成，请完成或移除后再保存。')
      return
    }
    mutation.mutate()
  }

  /**
   * 清除指定字段的错误提示；只在该字段原本有错误时更新状态。
   * @param field 字段错误键。
   */
  const clearFieldError = (field: keyof RequirementFieldErrors) => {
    setFieldErrors((current) => (current[field] ? { ...current, [field]: undefined } : current))
  }

  const memberList = members.data?.data ?? []
  const teamMemberOptions = memberList.map(toMemberOption)
  const memberOptions = teamMemberOptions.filter((option) => option.available)
  const collaboratorDetails: MemberSelectionDetail[] = collaboratorUserIds.map(
    (userId) =>
      teamMemberOptions.find((member) => member.userId === userId) ??
      requirement?.collaborators.find((member) => member.userId === userId) ?? {
        userId,
        name: '未知成员',
        status: 'missing',
        available: false,
      },
  )
  const membersError = members.isError ? describeRequestError(members.error).description : null
  const ownerPickerProps = {
    options: memberOptions,
    currentUserId,
    loading: members.isPending || members.isFetching,
    error: membersError,
    onRetry: () => void members.refetch(),
    disabled: mutation.isPending,
    collisionBoundary: formBody,
  }
  const hasUnfinishedAttachmentsPending = hasUnfinishedAttachments(attachments)
  /**
   * 同步附件行并清除上一次的附件阻塞提示。
   * @param next 新的附件行集合。
   */
  const updateAttachments = (next: PendingAttachment[]) => {
    setAttachments(next)
    setAttachmentError('')
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent layout="form" onCloseAutoFocus={onCloseAutoFocus}>
        <form className="flex min-h-0 flex-1 flex-col" onSubmit={submit}>
          <DialogFormHeader>
            <DialogTitle className="text-xl">
              {requirement
                ? `编辑需求 ${REQUIREMENT_STATUS_LABELS[requirement.status] ? `· ${REQUIREMENT_STATUS_LABELS[requirement.status]}` : ''}`
                : '创建需求'}
            </DialogTitle>
          </DialogFormHeader>
          <DialogFormBody ref={setFormBody}>
            <div className="space-y-6">
              <FormSection title="基本信息">
                <FormField label="标题" htmlFor="requirement-title" required error={fieldErrors.title}>
                  <Input
                    id="requirement-title"
                    ref={titleRef}
                    value={title}
                    onChange={(event) => {
                      setTitle(event.target.value)
                      clearFieldError('title')
                    }}
                    aria-invalid={fieldErrors.title ? true : undefined}
                    maxLength={200}
                    autoFocus
                  />
                </FormField>
                <FormField label="内容方式" htmlFor="requirement-content-mode" required>
                  <Select
                    className="flex w-full"
                    id="requirement-content-mode"
                    value={contentMode}
                    onChange={(event) => setContentMode(event.target.value as 'markdown' | 'external_link')}
                  >
                    <option value="markdown">内置 Markdown</option>
                    <option value="external_link">外部文档链接</option>
                  </Select>
                </FormField>
                {contentMode === 'markdown' ? (
                  <FormField
                    label="正文"
                    htmlFor="requirement-content"
                    required
                    help="支持 Markdown，说明背景、目标与范围。"
                    error={fieldErrors.contentMarkdown}
                  >
                    <Textarea
                      id="requirement-content"
                      ref={contentRef}
                      className="min-h-27"
                      value={contentMarkdown}
                      onChange={(event) => {
                        setContentMarkdown(event.target.value)
                        clearFieldError('contentMarkdown')
                      }}
                      aria-invalid={fieldErrors.contentMarkdown ? true : undefined}
                    />
                  </FormField>
                ) : (
                  <>
                    <FormField
                      label="外部链接"
                      htmlFor="requirement-external-url"
                      required
                      error={fieldErrors.externalUrl}
                    >
                      <Input
                        id="requirement-external-url"
                        ref={externalUrlRef}
                        value={externalUrl}
                        onChange={(event) => {
                          setExternalUrl(event.target.value)
                          clearFieldError('externalUrl')
                        }}
                        aria-invalid={fieldErrors.externalUrl ? true : undefined}
                        placeholder="https://…"
                      />
                    </FormField>
                    <FormField label="本地摘要" htmlFor="requirement-external-summary">
                      <Textarea
                        id="requirement-external-summary"
                        className="min-h-22"
                        value={externalSummary}
                        onChange={(event) => setExternalSummary(event.target.value)}
                      />
                    </FormField>
                  </>
                )}
                <FormField label="验收标准" htmlFor="requirement-acceptance">
                  <Textarea
                    id="requirement-acceptance"
                    className="min-h-22"
                    value={acceptanceCriteria}
                    onChange={(event) => setAcceptanceCriteria(event.target.value)}
                  />
                </FormField>
              </FormSection>
              <FormSection title="负责人与协作人">
                <FormGrid>
                  <FormField label="研发负责人" htmlFor="requirement-dev-owner">
                    <MemberSelect
                      {...ownerPickerProps}
                      id="requirement-dev-owner"
                      value={devOwnerUserId}
                      onValueChange={setDevOwnerUserId}
                      selectedDetail={
                        teamMemberOptions.find((member) => member.userId === devOwnerUserId) ?? requirement?.devOwner
                      }
                    />
                  </FormField>
                  <FormField label="测试负责人" htmlFor="requirement-test-owner">
                    <MemberSelect
                      {...ownerPickerProps}
                      id="requirement-test-owner"
                      value={testOwnerUserId}
                      onValueChange={setTestOwnerUserId}
                      selectedDetail={
                        teamMemberOptions.find((member) => member.userId === testOwnerUserId) ?? requirement?.testOwner
                      }
                    />
                  </FormField>
                </FormGrid>
                <FormField
                  label="协作人员"
                  labelId={collaboratorLabelId}
                  messageId={collaboratorMessageId}
                  help={`可搜索姓名或邮箱，最多选择 20 人。${
                    collaboratorUserIds.length > 0 ? `已选 ${collaboratorUserIds.length} 人。` : ''
                  }`}
                >
                  <MemberMultiSelect
                    values={collaboratorUserIds}
                    onValuesChange={setCollaboratorUserIds}
                    options={memberOptions}
                    selectedDetails={collaboratorDetails}
                    maxSelected={20}
                    loading={members.isPending}
                    error={membersError}
                    onRetry={() => void members.refetch()}
                    disabled={mutation.isPending}
                    placeholder="搜索姓名或邮箱"
                    labelId={collaboratorLabelId}
                    describedBy={collaboratorMessageId}
                  />
                </FormField>
              </FormSection>
              <FormSection title="附件">
                <AttachmentField
                  projectId={projectId}
                  value={attachments}
                  onChange={updateAttachments}
                  disabled={mutation.isPending}
                  label="附件文件"
                  error={attachmentError}
                  editing={Boolean(requirement)}
                />
              </FormSection>
            </div>
          </DialogFormBody>
          {error && (
            <p role="alert" className="px-4 pb-2 text-sm text-destructive sm:px-6">
              {error}
            </p>
          )}
          {hasUnfinishedAttachmentsPending && (
            <p className="px-4 pb-2 text-xs text-muted-foreground sm:px-6">请先完成附件上传或移除失败附件。</p>
          )}
          <DialogFormFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button type="submit" disabled={mutation.isPending || hasUnfinishedAttachmentsPending}>
              {mutation.isPending ? '保存中…' : '保存'}
            </Button>
          </DialogFormFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
