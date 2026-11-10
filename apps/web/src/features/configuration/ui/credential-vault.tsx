import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ApiBody } from '@dev-ops/api-client'
import { useSession } from '@/features/identity/public'
import { projectListQueryOptions } from '@/features/projects/public'
import { apiClient } from '@/shared/api/client'
import { describeRequestError } from '@/shared/api/errors'
import { DelayedLoading } from '@/shared/ui/delayed-loading'
import { Button } from '@/shared/ui/controls/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/controls/dialog'
import { Input } from '@/shared/ui/controls/input'
import { Select } from '@/shared/ui/controls/select'
import { Textarea } from '@/shared/ui/controls/textarea'
import { useToast } from '@/shared/ui/toast'
import { EmptyState, PageLoading } from '@/shared/ui/page-state'
import { credentialUsageQueryOptions, credentialsQueryOptions, type CredentialList } from '../api/queries'

type CreateCredentialBody = ApiBody<'/api/v1/teams/{teamId}/credentials', 'post'>
type CredentialKind = 'api_key' | 'account_password' | 'ssh_key'
const KIND_LABELS: Record<string, string> = {
  api_key: 'API 密钥',
  account_password: '账号密码',
  ssh_key: 'SSH 密钥',
  active: '可用',
  revoked: '已撤销',
  expired: '已过期',
}
const ACTION_TITLES = { rotate: '轮换凭据', revoke: '撤销凭据', grant: '授权项目' } as const
type ActionKind = keyof typeof ACTION_TITLES
const EMPTY_FORM = { name: '', kind: 'api_key' as CredentialKind, description: '', value: '' }

/** 团队凭据库：管理员管理凭据与授权，开发者只读被授权元数据，明文不展示。 */
export function CredentialVault() {
  const { currentTeam, role } = useSession()
  const canManage = role === 'admin'
  const teamId = currentTeam?.id ?? ''
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const [search, setSearch] = useState('')
  const [kind, setKind] = useState<'' | 'api_key' | 'account_password' | 'ssh_key'>('')
  const [selectedId, setSelectedId] = useState('')
  const list = useQuery(credentialsQueryOptions(teamId, { ...(search ? { search } : {}), ...(kind ? { kind } : {}) }))
  type CredentialSummary = CredentialList['items'][number]
  const selected = list.data?.data.items.find((item) => item.id === selectedId) ?? list.data?.data.items[0] ?? null
  const usage = useQuery({ ...credentialUsageQueryOptions(selected?.id ?? ''), enabled: Boolean(selected?.id) })
  const projects = useQuery({
    ...projectListQueryOptions(teamId, { page: 1, pageSize: 100 }),
    enabled: Boolean(teamId) && canManage,
  })
  const [createOpen, setCreateOpen] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [action, setAction] = useState<{ kind: ActionKind; target: CredentialSummary } | null>(null)
  const [actionValue, setActionValue] = useState('')
  const [actionProjectId, setActionProjectId] = useState('')

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['configuration'] })
  }
  const create = useMutation({
    mutationFn: async () => {
      const body: CreateCredentialBody = {
        name: form.name.trim(),
        kind: form.kind,
        description: form.description.trim() || undefined,
        value: form.value,
      }
      return apiClient.createCredential(teamId, body)
    },
    onSuccess: async () => {
      await refresh()
      setCreateOpen(false)
      setForm(EMPTY_FORM)
      showToast('凭据已创建并加密保存。', 'success')
    },
    onError: (error: unknown) => showToast(describeRequestError(error).description, 'error'),
  })
  const runAction = useMutation({
    mutationFn: async () => {
      if (!action) throw new Error('缺少操作目标')
      const target = action.target
      if (action.kind === 'rotate') return apiClient.rotateCredential(target.id, { value: actionValue })
      if (action.kind === 'revoke') return apiClient.revokeCredential(target.id, { reason: actionValue })
      return apiClient.grantCredential(target.id, {
        projectId: actionProjectId,
        ...(actionValue ? { expiresAt: new Date(actionValue).toISOString() } : {}),
      })
    },
    onSuccess: async () => {
      await refresh()
      setAction(null)
      setActionValue('')
      setActionProjectId('')
      showToast('操作已完成。', 'success')
    },
    onError: (error: unknown) => showToast(describeRequestError(error).description, 'error'),
  })
  const submitCreate = (event: FormEvent) => {
    event.preventDefault()
    if (!form.name.trim()) return showToast('请填写凭据名称。', 'error')
    if (!form.value) return showToast('请填写凭据值。', 'error')
    create.mutate()
  }
  if (!currentTeam) return <EmptyState mascot="group" title="尚未加入团队" description="加入团队后可使用凭据库。" />
  return (
    <div className="catalog">
      <div className="row spread">
        <h1>凭据库</h1>
        {canManage ? (
          <Button type="button" onClick={() => setCreateOpen(true)}>
            添加凭据
          </Button>
        ) : null}
      </div>
      <div className="row">
        <Input
          aria-label="搜索凭据"
          placeholder="搜索名称或说明"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <Select aria-label="凭据分类" value={kind} onChange={(event) => setKind(event.target.value as typeof kind)}>
          <option value="">全部分类</option>
          <option value="api_key">API 密钥</option>
          <option value="account_password">账号密码</option>
          <option value="ssh_key">SSH 密钥</option>
        </Select>
      </div>
      <div className="row vault-layout">
        <section aria-label="凭据列表" className="vault-list">
          {list.isPending ? (
            <DelayedLoading pending>
              <PageLoading />
            </DelayedLoading>
          ) : list.isError ? (
            <EmptyState title="凭据加载失败" description={describeRequestError(list.error).description} />
          ) : list.data.data.items.length === 0 ? (
            <EmptyState
              mascot="prism"
              title="凭据库还是空的"
              description="添加团队凭据后可授权项目使用。"
              action={
                canManage ? (
                  <Button type="button" onClick={() => setCreateOpen(true)}>
                    添加凭据
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <ul className="plain-list">
              {list.data.data.items.map((credential) => (
                <li key={credential.id}>
                  <Button
                    type="button"
                    variant={credential.id === selected?.id ? 'secondary' : 'ghost'}
                    onClick={() => setSelectedId(credential.id)}
                  >
                    {credential.name}
                    <span className="muted">{KIND_LABELS[credential.kind] ?? credential.kind}</span>
                    <span className="tag">{KIND_LABELS[credential.status] ?? credential.status}</span>
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section aria-label="凭据详情" className="vault-detail">
          {selected ? (
            <>
              <h2>{selected.name}</h2>
              <p className="muted">
                {KIND_LABELS[selected.kind] ?? selected.kind} · 版本 v{selected.currentVersion} · 明文掩码{' '}
                {selected.maskedValue}
              </p>
              <p>{selected.description ?? '无说明'}</p>
              <p className="muted">过期时间：{selected.expiresAt ?? '长期有效'}</p>
              <h3>项目授权</h3>
              {selected.grants.length === 0 ? (
                <p className="muted">尚未授权项目。</p>
              ) : (
                <ul className="plain-list">
                  {selected.grants.map((grant) => (
                    <li key={grant.projectId}>
                      <span>{grant.projectId}</span>
                      <span className="muted">{grant.expiresAt ?? '长期'}</span>
                      <span className="tag">{grant.revokedAt ? '已撤销' : '生效中'}</span>
                    </li>
                  ))}
                </ul>
              )}
              {canManage ? (
                <div className="row">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setAction({ kind: 'rotate', target: selected })
                      setActionValue('')
                    }}
                  >
                    轮换
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setAction({ kind: 'grant', target: selected })
                      setActionValue('')
                      setActionProjectId('')
                    }}
                  >
                    授权项目
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    onClick={() => {
                      setAction({ kind: 'revoke', target: selected })
                      setActionValue('')
                    }}
                  >
                    撤销
                  </Button>
                </div>
              ) : null}
              <h3>使用记录</h3>
              {usage.isPending ? (
                <DelayedLoading pending>
                  <PageLoading />
                </DelayedLoading>
              ) : usage.isError || !usage.data ? (
                <p className="muted">使用记录不可用。</p>
              ) : usage.data.data.items.length === 0 ? (
                <p className="muted">暂无使用记录。</p>
              ) : (
                <ul className="plain-list">
                  {usage.data.data.items.map((item) => (
                    <li key={item.id}>
                      <span>{item.createdAt}</span>
                      <span className="muted">{item.action}</span>
                      <span className="muted">{item.result}</span>
                      <span className="muted">v{item.credentialVersion}</span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : null}
        </section>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <form className="space-y-4" onSubmit={submitCreate}>
            <DialogHeader>
              <DialogTitle>添加凭据</DialogTitle>
            </DialogHeader>
            <label className="block space-y-1.5 text-sm font-medium">
              名称
              <Input
                value={form.name}
                maxLength={120}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
              />
            </label>
            <label className="block space-y-1.5 text-sm font-medium">
              分类
              <Select
                value={form.kind}
                onChange={(event) => setForm({ ...form, kind: event.target.value as CredentialKind })}
              >
                <option value="api_key">API 密钥</option>
                <option value="account_password">账号密码</option>
                <option value="ssh_key">SSH 密钥</option>
              </Select>
            </label>
            <label className="block space-y-1.5 text-sm font-medium">
              说明
              <Textarea
                value={form.description}
                maxLength={1000}
                onChange={(event) => setForm({ ...form, description: event.target.value })}
              />
            </label>
            <label className="block space-y-1.5 text-sm font-medium">
              凭据值（保存后不再显示）
              <Textarea
                value={form.value}
                onChange={(event) => setForm({ ...form, value: event.target.value })}
                autoComplete="off"
              />
            </label>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
                取消
              </Button>
              <Button type="submit" disabled={create.isPending}>
                {create.isPending ? '保存中…' : '保存'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={action !== null} onOpenChange={(open) => (open ? undefined : setAction(null))}>
        <DialogContent>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault()
              runAction.mutate()
            }}
          >
            <DialogHeader>
              <DialogTitle>{action ? ACTION_TITLES[action.kind] : ''}</DialogTitle>
            </DialogHeader>
            {action?.kind === 'rotate' ? (
              <label className="block space-y-1.5 text-sm font-medium">
                新凭据值
                <Textarea
                  value={actionValue}
                  onChange={(event) => setActionValue(event.target.value)}
                  autoComplete="off"
                />
              </label>
            ) : null}
            {action?.kind === 'revoke' ? (
              <label className="block space-y-1.5 text-sm font-medium">
                撤销原因
                <Input value={actionValue} onChange={(event) => setActionValue(event.target.value)} maxLength={1000} />
              </label>
            ) : null}
            {action?.kind === 'grant' ? (
              <>
                <label className="block space-y-1.5 text-sm font-medium">
                  项目
                  <Select value={actionProjectId} onChange={(event) => setActionProjectId(event.target.value)}>
                    <option value="">选择项目</option>
                    {projects.data?.data.items.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name}
                      </option>
                    ))}
                  </Select>
                </label>
                <label className="block space-y-1.5 text-sm font-medium">
                  过期时间（可选）
                  <Input
                    type="datetime-local"
                    value={actionValue}
                    onChange={(event) => setActionValue(event.target.value)}
                  />
                </label>
              </>
            ) : null}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setAction(null)}>
                取消
              </Button>
              <Button type="submit" disabled={runAction.isPending}>
                {runAction.isPending ? '提交中…' : '确认'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
