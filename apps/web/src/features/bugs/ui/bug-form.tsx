import { useEffect, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { describeRequestError } from '@/shared/api/errors'
import { createIdempotencyKey, isBusinessError, type ApiBody } from '@dev-ops/api-client'
import { apiClient } from '@/shared/api/client'
import { Button } from '@/shared/ui/controls/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/controls/dialog'
import { Input } from '@/shared/ui/controls/input'
import { Select } from '@/shared/ui/controls/select'
import { Textarea } from '@/shared/ui/controls/textarea'
import { teamMembersQueryOptions } from '@/features/identity/public'
import type { BugDetail } from '../model/types'

type CreateBody = ApiBody<'/api/v1/projects/{projectId}/bugs', 'post'>
type UpdateBody = ApiBody<'/api/v1/bugs/{bugId}/update', 'post'>

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
  const members = useQuery(teamMembersQueryOptions(teamId))
  const [title, setTitle] = useState('')
  const [phenomenon, setPhenomenon] = useState('')
  const [expectedBehavior, setExpectedBehavior] = useState('')
  const [reproduction, setReproduction] = useState('')
  const [reproductionUnknown, setReproductionUnknown] = useState(false)
  const [evidenceText, setEvidenceText] = useState('')
  const [evidenceUrl, setEvidenceUrl] = useState('')
  const [fixOwnerUserId, setFixOwnerUserId] = useState('')
  const [error, setError] = useState('')
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
      }
      if (bug) return apiClient.updateBug(bug.id, { ...base, version: bug.version } as UpdateBody)
      return apiClient.createBug(
        projectId,
        { ...base, ...(requirementId ? { requirementIds: [requirementId] } : {}) } as CreateBody,
        { idempotencyKey: createIdempotencyKey() },
      )
    },
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ['bugs'] })
      await queryClient.invalidateQueries({ queryKey: ['projects'] })
      onOpenChange(false)
      onSaved?.(result.data.id)
    },
    onError: (cause: unknown) =>
      setError(isBusinessError(cause) ? describeRequestError(cause).description : '保存失败，请稍后重试。'),
  })
  const submit = (event: FormEvent) => {
    event.preventDefault()
    setError('')
    if (!title.trim()) return setError('请填写 Bug 标题。')
    if (!phenomenon.trim()) return setError('请填写现象。')
    if (!expectedBehavior.trim()) return setError('请填写预期行为。')
    if (!reproductionUnknown && !reproduction.trim()) return setError('请填写复现信息或标注无法稳定复现。')
    mutation.mutate()
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(720px,calc(100vw-32px))]">
        <form className="space-y-4" onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>{bug ? '编辑 Bug' : '创建 Bug'}</DialogTitle>
          </DialogHeader>
          <label className="block space-y-1.5 text-sm font-medium">
            标题
            <Input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} autoFocus />
          </label>
          <label className="block space-y-1.5 text-sm font-medium">
            现象
            <Textarea value={phenomenon} onChange={(event) => setPhenomenon(event.target.value)} />
          </label>
          <label className="block space-y-1.5 text-sm font-medium">
            预期行为
            <Textarea value={expectedBehavior} onChange={(event) => setExpectedBehavior(event.target.value)} />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={reproductionUnknown}
              onChange={(event) => setReproductionUnknown(event.target.checked)}
            />
            无法稳定复现，已记录现象
          </label>
          {!reproductionUnknown && (
            <label className="block space-y-1.5 text-sm font-medium">
              复现步骤
              <Textarea value={reproduction} onChange={(event) => setReproduction(event.target.value)} />
            </label>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1.5 text-sm font-medium">
              证据文本
              <Textarea value={evidenceText} onChange={(event) => setEvidenceText(event.target.value)} />
            </label>
            <label className="block space-y-1.5 text-sm font-medium">
              证据链接
              <Input
                value={evidenceUrl}
                onChange={(event) => setEvidenceUrl(event.target.value)}
                placeholder="https://…"
              />
            </label>
          </div>
          <label className="block space-y-1.5 text-sm font-medium">
            修复负责人
            <Select value={fixOwnerUserId} onChange={(event) => setFixOwnerUserId(event.target.value)}>
              <option value="">未指定</option>
              {(members.data?.data ?? []).map((member) => (
                <option key={member.userId} value={member.userId}>
                  {member.name}
                </option>
              ))}
            </Select>
          </label>
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
