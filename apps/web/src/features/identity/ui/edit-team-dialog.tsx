import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/shared/api/client'
import { describeRequestError } from '@/shared/api/errors'
import { Button } from '@/shared/ui/controls/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/controls/dialog'
import { Input } from '@/shared/ui/controls/input'
import { Textarea } from '@/shared/ui/controls/textarea'
import { useToast } from '@/shared/ui/toast'
import { useSession } from '../model/session'

/**
 * 编辑团队资料弹窗；保存成功后关闭并把焦点归还触发按钮。
 * @param props.open 弹窗打开状态；onOpenChange 关闭回调。
 * @returns 团队名称、图标标识和说明表单。
 */
export function EditTeamDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { currentTeam } = useSession()
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const [name, setName] = useState(currentTeam?.name ?? '')
  const [iconText, setIconText] = useState(currentTeam?.iconText ?? '')
  const [description, setDescription] = useState(currentTeam?.description ?? '')
  const [error, setError] = useState('')
  useEffect(() => {
    if (!open) return
    setName(currentTeam?.name ?? '')
    setIconText(currentTeam?.iconText ?? '')
    setDescription(currentTeam?.description ?? '')
    setError('')
  }, [currentTeam, open])
  const mutation = useMutation({
    mutationFn: async () => {
      if (!currentTeam) throw new Error('当前团队未加载')
      return apiClient.updateTeam(currentTeam.id, {
        version: currentTeam.version ?? 1,
        name: name.trim(),
        iconText: iconText.trim() || null,
        description: description.trim() || null,
      })
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['identity', 'teams'] })
      showToast('团队资料已保存。', 'success')
      onOpenChange(false)
    },
    onError: (cause: unknown) => {
      const message = describeRequestError(cause).description
      setError(message)
      showToast(message, 'error')
    },
  })
  if (!currentTeam) return null
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            setError('')
            if (!name.trim()) {
              setError('请填写团队名称。')
              return
            }
            mutation.mutate()
          }}
        >
          <DialogHeader>
            <DialogTitle>编辑团队</DialogTitle>
          </DialogHeader>
          <label className="block space-y-1.5 text-sm font-medium">
            团队名称
            <Input
              value={name}
              maxLength={120}
              disabled={mutation.isPending}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label className="block space-y-1.5 text-sm font-medium">
            图标标识（最多 4 个字符）
            <Input
              value={iconText}
              maxLength={4}
              disabled={mutation.isPending}
              onChange={(event) => setIconText(event.target.value)}
            />
          </label>
          <label className="block space-y-1.5 text-sm font-medium">
            团队说明
            <Textarea
              value={description}
              maxLength={500}
              disabled={mutation.isPending}
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>
          {error && (
            <p role="alert" className="field-error">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={mutation.isPending} onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? '保存中…' : '保存团队资料'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
