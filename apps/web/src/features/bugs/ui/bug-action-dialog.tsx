import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createIdempotencyKey, isBusinessError } from '@dev-ops/api-client'
import { apiClient } from '@/shared/api/client'
import { useToast } from '@/shared/ui/toast'
import { Button } from '@/shared/ui/controls/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/controls/dialog'
import { Input } from '@/shared/ui/controls/input'
import { Select } from '@/shared/ui/controls/select'
import { Textarea } from '@/shared/ui/controls/textarea'
import { teamMembersQueryOptions } from '@/features/identity/public'
import type { BugDetail } from '../model/types'

export type BugAction = 'submit-regression' | 'withdraw-regression' | 'record-regression' | 'close' | 'reopen'
const TITLES: Record<BugAction, string> = {
  'submit-regression': '提交回归',
  'withdraw-regression': '撤回回归',
  'record-regression': '记录回归结论',
  close: '关闭 Bug',
  reopen: '重开 Bug',
}

/** Bug 状态动作对话框。 */
export function BugActionDialog({
  bug,
  action,
  teamId,
  open,
  onOpenChange,
  onDone,
}: {
  bug: BugDetail
  action: BugAction | null
  teamId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onDone?: () => void
}) {
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const members = useQuery(teamMembersQueryOptions(teamId))
  const [fixSummary, setFixSummary] = useState('')
  const [verifierUserId, setVerifierUserId] = useState('')
  const [note, setNote] = useState('')
  const [result, setResult] = useState<'passed' | 'failed'>('passed')
  const [category, setCategory] = useState<'duplicate' | 'not_bug' | 'wont_fix'>('not_bug')
  const [duplicateOfBugId, setDuplicateOfBugId] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    if (!open) return
    setFixSummary('')
    setVerifierUserId(bug.regressionOwner?.userId ?? '')
    setNote('')
    setResult('passed')
    setCategory('not_bug')
    setDuplicateOfBugId('')
    setError('')
  }, [open, bug])
  const mutation = useMutation({
    mutationFn: async () => {
      const version = bug.version
      switch (action) {
        case 'submit-regression':
          return apiClient.submitBugRegression(
            bug.id,
            { version, fixSummary: fixSummary.trim(), verifierUserId: verifierUserId || undefined },
            { idempotencyKey: createIdempotencyKey() },
          )
        case 'withdraw-regression':
          return apiClient.withdrawBugRegression(bug.id, { version, reason: note.trim() })
        case 'record-regression':
          return apiClient.recordBugRegression(bug.id, { version, result, note: note.trim() })
        case 'close':
          return apiClient.closeBug(bug.id, {
            version,
            category,
            note: note.trim(),
            ...(category === 'duplicate' ? { duplicateOfBugId: duplicateOfBugId.trim() } : {}),
          })
        case 'reopen':
          return apiClient.reopenBug(bug.id, { version, reason: note.trim() })
        default:
          return Promise.reject(new Error('未知动作'))
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['bugs'] })
      await queryClient.invalidateQueries({ queryKey: ['projects'] })
      onOpenChange(false)
      onDone?.()
    },
    onError: (cause: unknown) => {
      const message = isBusinessError(cause) ? cause.message : '操作失败，请稍后重试。'
      setError(message)
      showToast(message, 'error')
    },
  })
  if (!action) return null
  const submit = () => {
    setError('')
    if (action === 'submit-regression' && !fixSummary.trim()) return setError('请填写修复说明。')
    if (action === 'submit-regression' && !verifierUserId) return setError('请选择回归负责人。')
    if (action === 'close' && !note.trim()) return setError('请填写关闭说明。')
    if (action === 'close' && category === 'duplicate' && !duplicateOfBugId.trim())
      return setError('请填写被重复的原 Bug ID。')
    if (action !== 'submit-regression' && action !== 'record-regression' && !note.trim())
      return setError('请填写原因。')
    if (action === 'record-regression' && !note.trim()) return setError('请填写回归结论。')
    mutation.mutate()
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{TITLES[action]}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {action === 'submit-regression' && (
            <>
              <label className="block space-y-1.5 text-sm font-medium">
                修复说明
                <Textarea value={fixSummary} onChange={(event) => setFixSummary(event.target.value)} />
              </label>
              <label className="block space-y-1.5 text-sm font-medium">
                回归负责人
                <Select value={verifierUserId} onChange={(event) => setVerifierUserId(event.target.value)}>
                  <option value="">请选择</option>
                  {(members.data?.data ?? []).map((member) => (
                    <option key={member.userId} value={member.userId}>
                      {member.name}
                    </option>
                  ))}
                </Select>
              </label>
            </>
          )}
          {action === 'record-regression' && (
            <>
              <label className="block space-y-1.5 text-sm font-medium">
                结果
                <Select value={result} onChange={(event) => setResult(event.target.value as 'passed' | 'failed')}>
                  <option value="passed">通过</option>
                  <option value="failed">失败</option>
                </Select>
              </label>
              <label className="block space-y-1.5 text-sm font-medium">
                结论
                <Textarea value={note} onChange={(event) => setNote(event.target.value)} />
              </label>
            </>
          )}
          {action === 'close' && (
            <>
              <label className="block space-y-1.5 text-sm font-medium">
                关闭类别
                <Select value={category} onChange={(event) => setCategory(event.target.value as typeof category)}>
                  <option value="not_bug">非缺陷</option>
                  <option value="duplicate">重复</option>
                  <option value="wont_fix">不修复</option>
                </Select>
              </label>
              {category === 'duplicate' && (
                <label className="block space-y-1.5 text-sm font-medium">
                  原 Bug ID
                  <Input value={duplicateOfBugId} onChange={(event) => setDuplicateOfBugId(event.target.value)} />
                </label>
              )}
              <label className="block space-y-1.5 text-sm font-medium">
                关闭说明
                <Textarea value={note} onChange={(event) => setNote(event.target.value)} />
              </label>
            </>
          )}
          {action !== 'submit-regression' && action !== 'record-regression' && action !== 'close' && (
            <label className="block space-y-1.5 text-sm font-medium">
              原因
              <Textarea value={note} onChange={(event) => setNote(event.target.value)} />
            </label>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button type="button" disabled={mutation.isPending} onClick={submit}>
            {mutation.isPending ? '提交中…' : '确认'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
