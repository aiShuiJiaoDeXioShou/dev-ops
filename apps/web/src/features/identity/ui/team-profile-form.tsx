import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/shared/api/client'
import { describeRequestError } from '@/shared/api/errors'
import { Button } from '@/shared/ui/controls/button'
import { Input } from '@/shared/ui/controls/input'
import { Textarea } from '@/shared/ui/controls/textarea'
import { useToast } from '@/shared/ui/toast'
import { useSession } from '../model/session'

/** 管理员维护团队资料；普通成员只读展示。 */
export function TeamProfileForm() {
  const { currentTeam, role } = useSession()
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const canManage = role === 'admin'
  const [name, setName] = useState(currentTeam?.name ?? '')
  const [iconText, setIconText] = useState(currentTeam?.iconText ?? '')
  const [description, setDescription] = useState(currentTeam?.description ?? '')
  useEffect(() => {
    setName(currentTeam?.name ?? '')
    setIconText(currentTeam?.iconText ?? '')
    setDescription(currentTeam?.description ?? '')
  }, [currentTeam])
  const mutation = useMutation({
    mutationFn: async () => {
      if (!currentTeam) throw new Error('当前团队未加载')
      const version = currentTeam.version ?? 1
      return apiClient.updateTeam(currentTeam.id, {
        version,
        name: name.trim(),
        iconText: iconText.trim() || null,
        description: description.trim() || null,
      })
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['identity', 'teams'] })
      showToast('团队资料已保存。', 'success')
    },
    onError: (error: unknown) => showToast(describeRequestError(error).description, 'error'),
  })
  if (!currentTeam) return null
  return (
    <section aria-label="团队资料" className="settings-section">
      <h2 className="settings-section-title">团队资料</h2>
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault()
          if (!canManage) return
          if (!name.trim()) return showToast('请填写团队名称。', 'error')
          mutation.mutate()
        }}
      >
        <label className="block space-y-1.5 text-sm font-medium">
          团队名称
          <Input value={name} readOnly={!canManage} maxLength={120} onChange={(event) => setName(event.target.value)} />
        </label>
        <label className="block space-y-1.5 text-sm font-medium">
          图标标识（最多 4 个字符）
          <Input
            value={iconText}
            readOnly={!canManage}
            maxLength={4}
            onChange={(event) => setIconText(event.target.value)}
          />
        </label>
        <label className="block space-y-1.5 text-sm font-medium">
          团队说明
          <Textarea
            value={description}
            readOnly={!canManage}
            maxLength={500}
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
        {canManage ? (
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? '保存中…' : '保存团队资料'}
          </Button>
        ) : (
          <p className="muted">只有团队管理员可以修改团队资料。</p>
        )}
      </form>
    </section>
  )
}
