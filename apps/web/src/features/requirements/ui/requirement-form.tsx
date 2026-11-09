import { useEffect, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { describeRequestError } from '@/shared/api/errors'
import { createIdempotencyKey, isBusinessError, type ApiBody } from '@dev-ops/api-client'
import { apiClient } from '@/shared/api/client'
import { useToast } from '@/shared/ui/toast'
import { Button } from '@/shared/ui/controls/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/controls/dialog'
import { Input } from '@/shared/ui/controls/input'
import { Select } from '@/shared/ui/controls/select'
import { Textarea } from '@/shared/ui/controls/textarea'
import { teamMembersQueryOptions } from '@/features/identity/public'
import type { RequirementDetail } from '../model/types'
import { REQUIREMENT_STATUS_LABELS } from '../model/labels'

type CreateBody = ApiBody<'/api/v1/projects/{projectId}/requirements', 'post'>
type UpdateBody = ApiBody<'/api/v1/requirements/{requirementId}/update', 'post'>

interface RequirementFormProps {
  projectId: string
  teamId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  requirement?: RequirementDetail | null
  onSaved?: (requirementId: string) => void
}

/** 创建或编辑需求；仅管理员/开发者可提交。 */
export function RequirementForm({ projectId, teamId, open, onOpenChange, requirement, onSaved }: RequirementFormProps) {
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
  const [error, setError] = useState('')

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
      const message = isBusinessError(cause) ? describeRequestError(cause).description : '保存失败，请稍后重试。'
      setError(message)
      showToast(message, 'error')
    },
  })
  const submit = (event: FormEvent) => {
    event.preventDefault()
    setError('')
    if (!title.trim()) return setError('请填写需求标题。')
    if (contentMode === 'markdown' && !contentMarkdown.trim()) return setError('请填写需求正文。')
    if (contentMode === 'external_link' && !/^https?:\/\//.test(externalUrl.trim()))
      return setError('外部链接必须是 HTTP/HTTPS 地址。')
    mutation.mutate()
  }
  const memberList = members.data?.data ?? []
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(640px,calc(100vw-32px))]">
        <form className="space-y-4" onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>
              {requirement
                ? `编辑需求 ${REQUIREMENT_STATUS_LABELS[requirement.status] ? `· ${REQUIREMENT_STATUS_LABELS[requirement.status]}` : ''}`
                : '创建需求'}
            </DialogTitle>
          </DialogHeader>
          <label className="block space-y-1.5 text-sm font-medium">
            标题
            <Input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} autoFocus />
          </label>
          <label className="block space-y-1.5 text-sm font-medium">
            内容方式
            <Select
              value={contentMode}
              onChange={(event) => setContentMode(event.target.value as 'markdown' | 'external_link')}
            >
              <option value="markdown">内置 Markdown</option>
              <option value="external_link">外部文档链接</option>
            </Select>
          </label>
          {contentMode === 'markdown' ? (
            <label className="block space-y-1.5 text-sm font-medium">
              正文
              <Textarea
                className="min-h-40"
                value={contentMarkdown}
                onChange={(event) => setContentMarkdown(event.target.value)}
              />
            </label>
          ) : (
            <div className="space-y-3">
              <label className="block space-y-1.5 text-sm font-medium">
                外部链接
                <Input
                  value={externalUrl}
                  onChange={(event) => setExternalUrl(event.target.value)}
                  placeholder="https://…"
                />
              </label>
              <label className="block space-y-1.5 text-sm font-medium">
                本地摘要
                <Textarea value={externalSummary} onChange={(event) => setExternalSummary(event.target.value)} />
              </label>
            </div>
          )}
          <label className="block space-y-1.5 text-sm font-medium">
            验收标准
            <Textarea value={acceptanceCriteria} onChange={(event) => setAcceptanceCriteria(event.target.value)} />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1.5 text-sm font-medium">
              研发负责人
              <Select value={devOwnerUserId} onChange={(event) => setDevOwnerUserId(event.target.value)}>
                <option value="">未指定</option>
                {memberList.map((member) => (
                  <option key={member.userId} value={member.userId}>
                    {member.name}
                  </option>
                ))}
              </Select>
            </label>
            <label className="block space-y-1.5 text-sm font-medium">
              测试负责人
              <Select value={testOwnerUserId} onChange={(event) => setTestOwnerUserId(event.target.value)}>
                <option value="">未指定</option>
                {memberList.map((member) => (
                  <option key={member.userId} value={member.userId}>
                    {member.name}
                  </option>
                ))}
              </Select>
            </label>
          </div>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">协作人员</legend>
            <div className="flex flex-wrap gap-3">
              {memberList.map((member) => (
                <label key={member.userId} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={collaboratorUserIds.includes(member.userId)}
                    onChange={(event) =>
                      setCollaboratorUserIds((current) =>
                        event.target.checked
                          ? [...current, member.userId]
                          : current.filter((id) => id !== member.userId),
                      )
                    }
                  />
                  {member.name}
                </label>
              ))}
            </div>
          </fieldset>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? '保存中…' : '保存'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
