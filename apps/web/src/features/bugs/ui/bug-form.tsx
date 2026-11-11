import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { describeRequestError } from '@/shared/api/errors'
import { createIdempotencyKey, isBusinessError, type ApiBody } from '@dev-ops/api-client'
import { apiClient } from '@/shared/api/client'
import { useToast } from '@/shared/ui/toast'
import { Button } from '@/shared/ui/controls/button'
import { Checkbox } from '@/shared/ui/controls/checkbox'
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
import {
  MemberMultiSelect,
  type MemberOption,
  type MemberSelectionDetail,
} from '@/shared/ui/controls/member-multiselect'
import { Select } from '@/shared/ui/controls/select'
import { Textarea } from '@/shared/ui/controls/textarea'
import { teamMembersQueryOptions } from '@/features/identity/public'
import {
  AttachmentField,
  describeAttachmentError,
  doneAttachmentIds,
  hasUnfinishedAttachments,
  toPendingAttachments,
  type PendingAttachment,
} from '@/features/attachments/public'
import type { BugDetail } from '../model/types'

type CreateBody = ApiBody<'/api/v1/projects/{projectId}/bugs', 'post'>

/** 缺陷表单的字段级错误；键名与字段一一对应，便于定位首个错误。 */
interface BugFieldErrors {
  title?: string
  phenomenon?: string
  expectedBehavior?: string
  reproduction?: string
}

/**
 * 把团队接口返回值转换为成员多选候选；候选只保留正常成员。
 * @param member 团队接口返回的成员。
 * @returns 成员多选所需选项；已停用成员不进入候选。
 */
function toMemberOption(member: {
  userId: string
  name: string
  email: string
  role: 'admin' | 'developer' | 'viewer'
  status: string
}): MemberOption {
  const isActive = member.status === 'active'
  return {
    userId: member.userId,
    name: member.name,
    email: member.email,
    role: member.role,
    status: isActive ? 'active' : 'disabled',
    available: isActive,
  }
}

/**
 * 滚动到首个错误字段并聚焦；优先保证窄屏和长表单下错误可见。
 * @param target 首个错误对应的可聚焦控件。
 */
function focusField(target: HTMLElement | null) {
  target?.scrollIntoView?.({ block: 'center' })
  target?.focus()
}

/** 创建或编辑 Bug。 */
export function BugForm({
  projectId,
  teamId,
  open,
  onOpenChange,
  bug,
  requirementId,
  onSaved,
}: {
  projectId: string
  teamId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  bug?: BugDetail | null
  requirementId?: string
  onSaved?: (bugId: string) => void
}) {
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const members = useQuery(teamMembersQueryOptions(teamId))
  const [title, setTitle] = useState('')
  const [phenomenon, setPhenomenon] = useState('')
  const [expectedBehavior, setExpectedBehavior] = useState('')
  const [reproduction, setReproduction] = useState('')
  const [reproductionUnknown, setReproductionUnknown] = useState(false)
  const [evidenceText, setEvidenceText] = useState('')
  const [evidenceUrl, setEvidenceUrl] = useState('')
  const [fixOwnerUserId, setFixOwnerUserId] = useState('')
  const [collaboratorUserIds, setCollaboratorUserIds] = useState<string[]>([])
  const [attachments, setAttachments] = useState<PendingAttachment[]>([])
  const [attachmentError, setAttachmentError] = useState('')
  const [fieldErrors, setFieldErrors] = useState<BugFieldErrors>({})
  const [error, setError] = useState('')
  const titleRef = useRef<HTMLInputElement>(null)
  const phenomenonRef = useRef<HTMLTextAreaElement>(null)
  const expectedBehaviorRef = useRef<HTMLTextAreaElement>(null)
  const reproductionRef = useRef<HTMLTextAreaElement>(null)
  const collaboratorLabelId = useId()
  const collaboratorMessageId = useId()
  useEffect(() => {
    if (!open) return
    setTitle(bug?.title ?? '')
    setPhenomenon(bug?.phenomenon ?? '')
    setExpectedBehavior(bug?.expectedBehavior ?? '')
    setReproduction(bug?.reproduction ?? '')
    setReproductionUnknown(bug?.reproductionUnknown ?? false)
    setEvidenceText(bug?.evidenceText ?? '')
    setEvidenceUrl(bug?.evidenceUrl ?? '')
    setFixOwnerUserId(bug?.fixOwner?.userId ?? '')
    setCollaboratorUserIds(bug?.collaborators.map((item) => item.userId) ?? [])
    setAttachments(toPendingAttachments(bug?.attachments ?? []))
    setAttachmentError('')
    setFieldErrors({})
    setError('')
  }, [open, bug])
  const mutation = useMutation({
    mutationFn: async () => {
      const base = {
        title: title.trim(),
        phenomenon: phenomenon.trim(),
        expectedBehavior: expectedBehavior.trim(),
        reproduction: reproductionUnknown ? null : reproduction.trim(),
        reproductionUnknown,
        evidenceText: evidenceText.trim() || null,
        evidenceUrl: evidenceUrl.trim() || null,
        fixOwnerUserId: fixOwnerUserId || null,
        collaboratorUserIds,
        attachmentIds: doneAttachmentIds(attachments),
      }
      if (bug) {
        return apiClient.updateBug(bug.id, { ...base, version: bug.version })
      }
      const createBody: CreateBody = {
        ...base,
        ...(requirementId ? { requirementIds: [requirementId] } : {}),
      }
      return apiClient.createBug(projectId, createBody, { idempotencyKey: createIdempotencyKey() })
    },
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ['bugs'] })
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
    const nextErrors: BugFieldErrors = {}
    let firstTarget: HTMLElement | null = null
    if (!title.trim()) {
      nextErrors.title = '请填写 Bug 标题。'
      firstTarget = titleRef.current
    }
    if (!phenomenon.trim()) {
      nextErrors.phenomenon = '请填写现象。'
      firstTarget ??= phenomenonRef.current
    }
    if (!expectedBehavior.trim()) {
      nextErrors.expectedBehavior = '请填写预期行为。'
      firstTarget ??= expectedBehaviorRef.current
    }
    if (!reproductionUnknown && !reproduction.trim()) {
      nextErrors.reproduction = '请填写复现信息或标注无法稳定复现。'
      firstTarget ??= reproductionRef.current
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
  const clearFieldError = (field: keyof BugFieldErrors) => {
    setFieldErrors((current) => (current[field] ? { ...current, [field]: undefined } : current))
  }

  const memberList = members.data?.data ?? []
  const memberOptions = memberList.map(toMemberOption).filter((option) => option.available)
  const collaboratorDetails: MemberSelectionDetail[] = collaboratorUserIds.map((userId) => {
    const member = memberList.find((item) => item.userId === userId)
    if (!member) return { userId, name: '未知成员', status: 'missing', available: false }
    const isActive = member.status === 'active'
    return { userId, name: member.name, status: isActive ? 'active' : 'disabled', available: isActive }
  })
  const membersError = members.isError ? describeRequestError(members.error).description : null
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
      <DialogContent layout="form">
        <form className="flex min-h-0 flex-1 flex-col" onSubmit={submit}>
          <DialogFormHeader>
            <DialogTitle className="text-xl">{bug ? '编辑 Bug' : '创建 Bug'}</DialogTitle>
          </DialogFormHeader>
          <DialogFormBody>
            <div className="space-y-6">
              <FormSection title="基本信息">
                <FormField label="标题" htmlFor="bug-title" required error={fieldErrors.title}>
                  <Input
                    id="bug-title"
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
                <FormField label="现象" htmlFor="bug-phenomenon" required error={fieldErrors.phenomenon}>
                  <Textarea
                    id="bug-phenomenon"
                    ref={phenomenonRef}
                    className="min-h-27"
                    value={phenomenon}
                    onChange={(event) => {
                      setPhenomenon(event.target.value)
                      clearFieldError('phenomenon')
                    }}
                    aria-invalid={fieldErrors.phenomenon ? true : undefined}
                  />
                </FormField>
                <FormField label="预期行为" htmlFor="bug-expected" required error={fieldErrors.expectedBehavior}>
                  <Textarea
                    id="bug-expected"
                    ref={expectedBehaviorRef}
                    className="min-h-22"
                    value={expectedBehavior}
                    onChange={(event) => {
                      setExpectedBehavior(event.target.value)
                      clearFieldError('expectedBehavior')
                    }}
                    aria-invalid={fieldErrors.expectedBehavior ? true : undefined}
                  />
                </FormField>
                <label className="form-inline-label flex flex-row items-center gap-2 text-sm font-medium">
                  <Checkbox
                    checked={reproductionUnknown}
                    onCheckedChange={(checked) => {
                      setReproductionUnknown(checked === true)
                      clearFieldError('reproduction')
                    }}
                  />
                  无法稳定复现，已记录现象
                </label>
                {!reproductionUnknown && (
                  <FormField
                    label="复现步骤"
                    htmlFor="bug-reproduction"
                    help="一行一步，便于他人按步骤复现。"
                    error={fieldErrors.reproduction}
                  >
                    <Textarea
                      id="bug-reproduction"
                      ref={reproductionRef}
                      className="min-h-22"
                      value={reproduction}
                      onChange={(event) => {
                        setReproduction(event.target.value)
                        clearFieldError('reproduction')
                      }}
                      aria-invalid={fieldErrors.reproduction ? true : undefined}
                    />
                  </FormField>
                )}
                <FormGrid>
                  <FormField label="证据文本" htmlFor="bug-evidence-text">
                    <Textarea
                      id="bug-evidence-text"
                      className="min-h-22"
                      value={evidenceText}
                      onChange={(event) => setEvidenceText(event.target.value)}
                      placeholder="日志片段 / 请求 ID"
                    />
                  </FormField>
                  <FormField label="证据链接" htmlFor="bug-evidence-url">
                    <Input
                      id="bug-evidence-url"
                      value={evidenceUrl}
                      onChange={(event) => setEvidenceUrl(event.target.value)}
                      placeholder="https://…"
                    />
                  </FormField>
                </FormGrid>
              </FormSection>
              <FormSection title="负责人与协作人">
                <FormField label="修复负责人" htmlFor="bug-fix-owner">
                  <Select
                    className="flex w-full"
                    id="bug-fix-owner"
                    value={fixOwnerUserId}
                    onChange={(event) => setFixOwnerUserId(event.target.value)}
                  >
                    <option value="">未指定</option>
                    {memberList.map((member) => (
                      <option key={member.userId} value={member.userId}>
                        {member.name}
                      </option>
                    ))}
                  </Select>
                </FormField>
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
                  editing={Boolean(bug)}
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
