import { useEffect, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { isBusinessError } from '@dev-ops/api-client'
import { apiClient } from '@/shared/api/client'
import { Button } from '@/shared/ui/controls/button'
import { Input } from '@/shared/ui/controls/input'
import { Select } from '@/shared/ui/controls/select'
import { Textarea } from '@/shared/ui/controls/textarea'
import { teamMembersQueryOptions } from '@/features/identity/public'
import type { ApiSuccessData } from '@dev-ops/api-client'

type Project = ApiSuccessData<'/api/v1/projects/{projectId}', 'get'>
const STATUS_LABELS = { active: '进行中', paused: '暂停', ended: '已结束' } as const

/** 项目基础信息与状态编辑。 */
export function ProjectSettingsForm({ project }: { project: Project }) {
  const queryClient = useQueryClient()
  const members = useQuery(teamMembersQueryOptions(project.teamId))
  const [name, setName] = useState(project.name)
  const [description, setDescription] = useState(project.description ?? '')
  const [status, setStatus] = useState(project.status)
  const [statusReason, setStatusReason] = useState('')
  const [ownerUserId, setOwnerUserId] = useState(project.owner.userId)
  const [error, setError] = useState('')
  useEffect(() => {
    setName(project.name)
    setDescription(project.description ?? '')
    setStatus(project.status)
    setOwnerUserId(project.owner.userId)
    setStatusReason('')
  }, [project])
  const mutation = useMutation({
    mutationFn: () =>
      apiClient.updateProject(project.id, {
        version: project.version,
        name: name.trim(),
        description: description.trim() || null,
        ownerUserId,
        status,
        ...(status !== project.status ? { statusReason: statusReason.trim() } : {}),
      }),
    onSuccess: async () => {
      setError('')
      await queryClient.invalidateQueries({ queryKey: ['projects'] })
    },
    onError: (cause: unknown) => setError(isBusinessError(cause) ? cause.message : '项目更新失败。'),
  })
  const submit = (event: FormEvent) => {
    event.preventDefault()
    setError('')
    if (!name.trim()) return setError('请填写项目名称。')
    if (status !== project.status && !statusReason.trim()) return setError('变更项目状态必须填写原因。')
    mutation.mutate()
  }
  return (
    <form className="space-y-4 rounded-xl border bg-card p-5" onSubmit={submit}>
      <h2 className="text-lg font-semibold">项目资料</h2>
      <label className="block space-y-1.5 text-sm font-medium">
        名称
        <Input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} />
      </label>
      <label className="block space-y-1.5 text-sm font-medium">
        说明
        <Textarea value={description} onChange={(event) => setDescription(event.target.value)} />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block space-y-1.5 text-sm font-medium">
          负责人
          <Select value={ownerUserId} onChange={(event) => setOwnerUserId(event.target.value)}>
            {(members.data?.data ?? []).map((member) => (
              <option key={member.userId} value={member.userId}>
                {member.name}
              </option>
            ))}
          </Select>
        </label>
        <label className="block space-y-1.5 text-sm font-medium">
          状态
          <Select value={status} onChange={(event) => setStatus(event.target.value as typeof status)}>
            {Object.entries(STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </label>
      </div>
      {status !== project.status && (
        <label className="block space-y-1.5 text-sm font-medium">
          状态变更原因
          <Textarea value={statusReason} onChange={(event) => setStatusReason(event.target.value)} />
        </label>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex justify-end">
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? '保存中…' : '保存项目'}
        </Button>
      </div>
    </form>
  )
}
