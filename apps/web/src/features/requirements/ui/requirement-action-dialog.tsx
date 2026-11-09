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
import type { RequirementDetail } from '../model/types'
import { SELF_TEST_LABELS } from '../model/labels'

export type RequirementAction =
  'submit-test' | 'withdraw-test' | 'return-to-development' | 'pass-test' | 'reopen-development' | 'cancel' | 'restore'

const TITLES: Record<RequirementAction, string> = {
  'submit-test': '提测',
  'withdraw-test': '撤回测试',
  'return-to-development': '退回开发',
  'pass-test': '测试通过',
  'reopen-development': '重新开发',
  cancel: '取消需求',
  restore: '恢复需求',
}

/** 需求流程动作对话框。 */
export function RequirementActionDialog({
  requirement,
  action,
  teamId,
  open,
  onOpenChange,
  onDone,
}: {
  requirement: RequirementDetail
  action: RequirementAction | null
  teamId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onDone?: () => void
}) {
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const members = useQuery(teamMembersQueryOptions(teamId))
  const [reason, setReason] = useState('')
  const [testOwnerUserId, setTestOwnerUserId] = useState('')
  const [scopeNote, setScopeNote] = useState('')
  const [selfTestResult, setSelfTestResult] = useState('passed')
  const [selfTestNote, setSelfTestNote] = useState('')
  const [testEntry, setTestEntry] = useState('')
  const [versionNote, setVersionNote] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    if (!open) return
    setReason('')
    setTestOwnerUserId(requirement.testOwner?.userId ?? '')
    setScopeNote('')
    setSelfTestResult('passed')
    setSelfTestNote('')
    setTestEntry('')
    setVersionNote('')
    setError('')
  }, [open, requirement])
  const mutation = useMutation({
    mutationFn: async () => {
      const version = requirement.version
      switch (action) {
        case 'submit-test':
          return apiClient.submitRequirementTest(
            requirement.id,
            {
              version,
              testOwnerUserId,
              scopeNote: scopeNote.trim(),
              selfTestResult: selfTestResult as 'passed' | 'has_failures' | 'not_run' | 'not_applicable',
              selfTestNote: selfTestNote.trim() || null,
              testEntry: testEntry.trim() || null,
              versionNote: versionNote.trim() || null,
            },
            { idempotencyKey: createIdempotencyKey() },
          )
        case 'withdraw-test':
          return apiClient.withdrawRequirementTest(requirement.id, { version, reason: reason.trim() })
        case 'return-to-development':
          return apiClient.returnRequirementToDevelopment(requirement.id, { version, reason: reason.trim() })
        case 'pass-test':
          return apiClient.passRequirementTest(requirement.id, { version, conclusion: reason.trim() })
        case 'reopen-development':
          return apiClient.reopenRequirementDevelopment(requirement.id, { version, reason: reason.trim() })
        case 'cancel':
          return apiClient.cancelRequirement(requirement.id, { version, reason: reason.trim() })
        case 'restore':
          return apiClient.restoreRequirement(requirement.id, { version, reason: reason.trim() })
        default:
          return Promise.reject(new Error('未知动作'))
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['requirements'] })
      await queryClient.invalidateQueries({ queryKey: ['projects'] })
      onOpenChange(false)
      onDone?.()
    },
    onError: (cause: unknown) => {
      const message = isBusinessError(cause) ? cause.message : '操作失败，请稍后重试。'
      setError(message)
      showToast(message)
    },
  })
  if (!action) return null
  const memberList = members.data?.data ?? []
  const submit = () => {
    setError('')
    if (action === 'submit-test') {
      if (!testOwnerUserId) return setError('请选择测试负责人。')
      if (!scopeNote.trim()) return setError('请填写测试范围。')
      if (selfTestResult !== 'passed' && !selfTestNote.trim()) return setError('非通过的自测结论必须填写说明。')
    } else if (!reason.trim()) return setError('请填写原因或结论。')
    mutation.mutate()
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{TITLES[action]}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {action === 'submit-test' ? (
            <>
              <label className="block space-y-1.5 text-sm font-medium">
                测试负责人
                <Select value={testOwnerUserId} onChange={(event) => setTestOwnerUserId(event.target.value)}>
                  <option value="">请选择</option>
                  {memberList.map((member) => (
                    <option key={member.userId} value={member.userId}>
                      {member.name}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="block space-y-1.5 text-sm font-medium">
                测试范围
                <Textarea value={scopeNote} onChange={(event) => setScopeNote(event.target.value)} />
              </label>
              <label className="block space-y-1.5 text-sm font-medium">
                自测结论
                <Select value={selfTestResult} onChange={(event) => setSelfTestResult(event.target.value)}>
                  {Object.entries(SELF_TEST_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
              </label>
              {selfTestResult !== 'passed' && (
                <label className="block space-y-1.5 text-sm font-medium">
                  自测说明
                  <Textarea value={selfTestNote} onChange={(event) => setSelfTestNote(event.target.value)} />
                </label>
              )}
              <label className="block space-y-1.5 text-sm font-medium">
                测试入口
                <Input value={testEntry} onChange={(event) => setTestEntry(event.target.value)} />
              </label>
              <label className="block space-y-1.5 text-sm font-medium">
                版本说明
                <Input value={versionNote} onChange={(event) => setVersionNote(event.target.value)} />
              </label>
            </>
          ) : (
            <label className="block space-y-1.5 text-sm font-medium">
              {action === 'pass-test' ? '测试结论' : '原因'}
              <Textarea value={reason} onChange={(event) => setReason(event.target.value)} />
            </label>
          )}
          {requirement.needsReview && (
            <p className="rounded-lg bg-warning/10 p-3 text-sm text-warning">该需求通过后存在未解决 Bug，需要复核。</p>
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
