import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSession } from '@/features/identity/public'
import { apiClient } from '@/shared/api/client'
import { describeRequestError } from '@/shared/api/errors'
import { Button } from '@/shared/ui/controls/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/controls/dialog'
import { Input } from '@/shared/ui/controls/input'
import { Select } from '@/shared/ui/controls/select'
import { useToast } from '@/shared/ui/toast'
import { EmptyState, PageLoading } from '@/shared/ui/page-state'
import { envVariablesQueryOptions, credentialsQueryOptions } from '../api/queries'

const ENVIRONMENTS = [
  { value: 'development', label: '开发' },
  { value: 'test', label: '测试' },
  { value: 'production', label: '生产' },
] as const
type Environment = 'development' | 'test' | 'production'
type VarKind = 'plain' | 'credential_ref'
const EMPTY_FORM = { name: '', kind: 'plain' as VarKind, value: '', credentialId: '' }

/** 项目环境变量：开发/测试/生产隔离，密钥只保存凭据引用，明文不回显。 */
export function EnvironmentVariables({ projectId }: { projectId: string }) {
  const { currentTeam, role } = useSession()
  const canManage = role === 'admin' || role === 'developer'
  const teamId = currentTeam?.id ?? ''
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const [environment, setEnvironment] = useState<Environment>('development')
  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [editingId, setEditingId] = useState('')
  const [editingVersion, setEditingVersion] = useState(1)
  const [removeTarget, setRemoveTarget] = useState<{ id: string; name: string } | null>(null)
  const [removeReason, setRemoveReason] = useState('')
  const variables = useQuery(envVariablesQueryOptions(projectId, environment))
  const credentials = useQuery({
    ...credentialsQueryOptions(teamId, { page: 1, pageSize: 100 }),
    enabled: Boolean(teamId),
  })
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['configuration', 'env-vars', projectId, environment] })
  }
  const save = useMutation({
    mutationFn: async () => {
      const base = {
        name: form.name.trim(),
        ...(form.kind === 'plain'
          ? { kind: 'plain' as const, value: form.value }
          : { kind: 'credential_ref' as const, credentialId: form.credentialId }),
      }
      if (editingId) {
        return apiClient.updateEnvVariable(editingId, {
          version: editingVersion,
          ...(form.kind === 'plain' ? { value: form.value } : { credentialId: form.credentialId }),
        })
      }
      return apiClient.createEnvVariable(projectId, environment, base)
    },
    onSuccess: async () => {
      await refresh()
      setFormOpen(false)
      setForm(EMPTY_FORM)
      setEditingId('')
      showToast('环境变量已保存。', 'success')
    },
    onError: (error: unknown) => showToast(describeRequestError(error).description, 'error'),
  })
  const remove = useMutation({
    mutationFn: async () => {
      if (!removeTarget) throw new Error('缺少目标变量')
      return apiClient.removeEnvVariable(removeTarget.id, { reason: removeReason.trim() })
    },
    onSuccess: async () => {
      await refresh()
      setRemoveTarget(null)
      setRemoveReason('')
      showToast('环境变量已删除。', 'success')
    },
    onError: (error: unknown) => showToast(describeRequestError(error).description, 'error'),
  })
  const openCreate = () => {
    setForm(EMPTY_FORM)
    setEditingId('')
    setFormOpen(true)
  }
  const openEdit = (input: {
    id: string
    name: string
    version: number
    kind: string
    credentialId?: string | null
  }) => {
    setForm({
      name: input.name,
      kind: input.kind === 'credential_ref' ? 'credential_ref' : 'plain',
      value: '',
      credentialId: input.credentialId ?? '',
    })
    setEditingId(input.id)
    setEditingVersion(input.version)
    setFormOpen(true)
  }
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!form.name.trim()) return showToast('请填写变量名称。', 'error')
    if (form.kind === 'plain' && !form.value) return showToast('请填写普通变量值。', 'error')
    if (form.kind === 'credential_ref' && !form.credentialId) return showToast('请选择已授权凭据。', 'error')
    save.mutate()
  }
  if (variables.isPending) return <PageLoading />
  if (variables.isError) {
    return <EmptyState title="环境变量加载失败" description={describeRequestError(variables.error).description} />
  }
  return (
    <div className="project-tab-panel">
      <div className="row spread">
        <div className="segments" role="tablist" aria-label="环境">
          {ENVIRONMENTS.map((item) => (
            <Button
              key={item.value}
              type="button"
              variant={environment === item.value ? 'secondary' : 'ghost'}
              size="sm"
              role="tab"
              aria-selected={environment === item.value}
              onClick={() => setEnvironment(item.value)}
            >
              {item.label}
            </Button>
          ))}
        </div>
        {canManage ? (
          <Button type="button" onClick={openCreate}>
            新增配置
          </Button>
        ) : null}
      </div>
      {variables.data.data.items.length === 0 ? (
        <EmptyState
          mascot="prism"
          title="这个环境还没有配置"
          description="当前环境还没有配置。"
          action={
            canManage ? (
              <Button type="button" onClick={openCreate}>
                新增配置
              </Button>
            ) : undefined
          }
        />
      ) : (
        <ul className="plain-list">
          {variables.data.data.items.map((item) => (
            <li key={item.id}>
              <span>{item.name}</span>
              <span className="tag">{item.kind === 'plain' ? '普通变量' : '密钥引用'}</span>
              <span className="muted">{item.masked ? '••••••••' : (item.valuePreview ?? '')}</span>
              <span className="tag">
                {item.status === 'active' ? '可用' : `失效（${item.invalidReason ?? '待核对'}）`}
              </span>
              {canManage ? (
                <>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      openEdit({
                        id: item.id,
                        name: item.name,
                        version: item.version,
                        kind: item.kind,
                        credentialId: item.credential?.id,
                      })
                    }
                  >
                    编辑
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    onClick={() => setRemoveTarget({ id: item.id, name: item.name })}
                  >
                    删除
                  </Button>
                </>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent>
          <form className="space-y-4" onSubmit={submit}>
            <DialogHeader>
              <DialogTitle>{editingId ? '编辑环境变量' : '新增环境变量'}</DialogTitle>
            </DialogHeader>
            <label className="block space-y-1.5 text-sm font-medium">
              环境
              <Input value={ENVIRONMENTS.find((item) => item.value === environment)?.label ?? ''} readOnly />
            </label>
            <label className="block space-y-1.5 text-sm font-medium">
              名称
              <Input
                value={form.name}
                maxLength={120}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
              />
            </label>
            <label className="block space-y-1.5 text-sm font-medium">
              类型
              <Select value={form.kind} onChange={(event) => setForm({ ...form, kind: event.target.value as VarKind })}>
                <option value="plain">普通变量</option>
                <option value="credential_ref">团队凭据引用</option>
              </Select>
            </label>
            {form.kind === 'plain' ? (
              <label className="block space-y-1.5 text-sm font-medium">
                变量值（敏感值请改用凭据引用）
                <Input value={form.value} onChange={(event) => setForm({ ...form, value: event.target.value })} />
              </label>
            ) : (
              <label className="block space-y-1.5 text-sm font-medium">
                凭据
                <Select
                  value={form.credentialId}
                  onChange={(event) => setForm({ ...form, credentialId: event.target.value })}
                >
                  <option value="">选择已授权凭据</option>
                  {credentials.data?.data.items.map((credential) => (
                    <option key={credential.id} value={credential.id}>
                      {credential.name}
                    </option>
                  ))}
                </Select>
              </label>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setFormOpen(false)}>
                取消
              </Button>
              <Button type="submit" disabled={save.isPending}>
                {save.isPending ? '保存中…' : '保存'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={removeTarget !== null} onOpenChange={(open) => (open ? undefined : setRemoveTarget(null))}>
        <DialogContent>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault()
              remove.mutate()
            }}
          >
            <DialogHeader>
              <DialogTitle>删除环境变量</DialogTitle>
            </DialogHeader>
            <p>确定删除 {removeTarget?.name}？引用该变量的流水线需要重新配置。</p>
            <label className="block space-y-1.5 text-sm font-medium">
              原因
              <Input value={removeReason} maxLength={1000} onChange={(event) => setRemoveReason(event.target.value)} />
            </label>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setRemoveTarget(null)}>
                取消
              </Button>
              <Button type="submit" variant="destructive" disabled={remove.isPending}>
                删除
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
