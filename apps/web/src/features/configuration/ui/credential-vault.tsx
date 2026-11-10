import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertCircle } from 'lucide-react'
import type { ApiBody } from '@dev-ops/api-client'
import { useSession } from '@/features/identity/public'
import { projectListQueryOptions } from '@/features/projects/public'
import { apiClient } from '@/shared/api/client'
import { describeRequestError } from '@/shared/api/errors'
import { formatDateTime } from '@/shared/lib/format'
import { DelayedLoading } from '@/shared/ui/delayed-loading'
import { Button } from '@/shared/ui/controls/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/controls/dialog'
import { Input } from '@/shared/ui/controls/input'
import { Select } from '@/shared/ui/controls/select'
import { Textarea } from '@/shared/ui/controls/textarea'
import { useToast } from '@/shared/ui/toast'
import { EmptyState, PageLoading } from '@/shared/ui/page-state'
import { credentialUsageQueryOptions, credentialsQueryOptions, type CredentialList } from '../api/queries'
import { CredentialValueReveal } from './credential-value-dialog'

type CreateCredentialBody = ApiBody<'/api/v1/teams/{teamId}/credentials', 'post'>
type CredentialKind = 'api_key' | 'account_password' | 'ssh_key'
type CredentialSummary = CredentialList['items'][number]
const KIND_LABELS: Record<string, string> = {
  api_key: 'API 密钥',
  account_password: '账号密码',
  ssh_key: 'SSH 密钥',
  active: '可用',
  revoked: '已撤销',
  expired: '已过期',
}
const USAGE_ACTION_LABELS: Record<string, string> = {
  use: '使用',
  create: '创建',
  rotate: '轮换',
  revoke: '撤销',
  grant: '授权',
  revoke_grant: '撤销授权',
  read_metadata: '读取元数据',
  reveal: '查看明文',
}
const USAGE_RESULT_LABELS: Record<string, string> = {
  success: '成功',
  denied: '被拒绝',
  expired: '已过期',
  failed: '失败',
}
const ACTION_TITLES = { rotate: '轮换凭据', revoke: '撤销凭据', grant: '授权项目' } as const
type ActionKind = keyof typeof ACTION_TITLES
const EMPTY_FORM = { name: '', kind: 'api_key' as CredentialKind, description: '', value: '' }

/** 团队凭据库：管理员管理凭据与授权，开发者只读被授权元数据；明文需登录密码二次确认后短暂展示。 */
export function CredentialVault() {
  const { currentTeam, role } = useSession()
  const canManage = role === 'admin'
  // 查看明文与只读元数据分离：管理员和开发者可用，浏览者不可见（页面入口本身也限制浏览者）。
  const canViewValue = role === 'admin' || role === 'developer'
  const teamId = currentTeam?.id ?? ''
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const [search, setSearch] = useState('')
  const [kind, setKind] = useState<'' | 'api_key' | 'account_password' | 'ssh_key'>('')
  const [selectedId, setSelectedId] = useState('')
  const list = useQuery(credentialsQueryOptions(teamId, { ...(search ? { search } : {}), ...(kind ? { kind } : {}) }))
  const items = list.data?.data.items ?? []
  const selected = items.find((item) => item.id === selectedId) ?? items[0] ?? null
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
  const clearFilters = () => {
    setSearch('')
    setKind('')
  }
  const hasFilters = Boolean(search.trim() || kind)
  if (!currentTeam) {
    return (
      <div className="catalog empty-page">
        <h1 className="sr-only">凭据库</h1>
        <EmptyState mascot="group" title="尚未加入团队" description="加入团队后可使用凭据库。" />
      </div>
    )
  }
  return (
    <div className="catalog vault-page">
      <div className="row spread">
        <h1>凭据库</h1>
        {canManage ? (
          <Button type="button" onClick={() => setCreateOpen(true)}>
            添加凭据
          </Button>
        ) : null}
      </div>
      <div className="row vault-filters">
        <Input
          aria-label="搜索凭据"
          placeholder="搜索名称或说明"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <Select
          className="shrink-0"
          aria-label="凭据分类"
          value={kind}
          onChange={(event) => setKind(event.target.value as typeof kind)}
        >
          <option value="">全部分类</option>
          <option value="api_key">API 密钥</option>
          <option value="account_password">账号密码</option>
          <option value="ssh_key">SSH 密钥</option>
        </Select>
      </div>
      {list.isPending ? (
        <div className="vault-body">
          <DelayedLoading pending>
            <PageLoading />
          </DelayedLoading>
        </div>
      ) : list.isError ? (
        <div className="vault-body empty-page">
          <EmptyState
            icon={<AlertCircle />}
            title="凭据加载失败"
            description={describeRequestError(list.error).description}
            action={
              <Button type="button" variant="outline" onClick={() => void list.refetch()}>
                重新加载
              </Button>
            }
          />
        </div>
      ) : items.length === 0 ? (
        <div className="vault-body empty-page">
          <EmptyState
            mascot="prism"
            title={hasFilters ? '没有匹配的凭据' : '凭据库还是空的'}
            description={
              hasFilters ? '当前搜索或分类没有找到凭据，可以清除筛选后重新查看。' : '添加团队凭据后可授权项目使用。'
            }
            action={
              hasFilters ? (
                <Button type="button" variant="outline" onClick={clearFilters}>
                  清除筛选
                </Button>
              ) : canManage ? (
                <Button type="button" onClick={() => setCreateOpen(true)}>
                  添加凭据
                </Button>
              ) : undefined
            }
          />
        </div>
      ) : (
        <div className="vault-layout">
          <section aria-label="凭据列表" className="vault-list">
            <ul className="plain-list">
              {items.map((credential) => (
                <li key={credential.id}>
                  <Button
                    type="button"
                    variant={credential.id === selected?.id ? 'secondary' : 'ghost'}
                    className="vault-item"
                    aria-current={credential.id === selected?.id ? 'true' : undefined}
                    onClick={() => setSelectedId(credential.id)}
                  >
                    <span className="vault-item-name">{credential.name}</span>
                    <span className="vault-item-meta">
                      {KIND_LABELS[credential.kind] ?? credential.kind}
                      <span className="badge">{KIND_LABELS[credential.status] ?? credential.status}</span>
                    </span>
                  </Button>
                </li>
              ))}
            </ul>
          </section>
          <section aria-label="凭据详情" className="vault-detail">
            {selected ? (
              <>
                <div className="vault-detail-identity">
                  <div className="row spread">
                    <h2>{selected.name}</h2>
                    <span className="badge">{KIND_LABELS[selected.status] ?? selected.status}</span>
                  </div>
                  <p className="muted small">
                    {KIND_LABELS[selected.kind] ?? selected.kind} · v{selected.currentVersion}
                  </p>
                  {/* key 绑定凭据 id 与版本/状态：切换选中凭据或轮换、撤销后重建组件，立即清除明文、密码与倒计时。 */}
                  <CredentialValueReveal
                    key={`${selected.id}:${selected.currentVersion}:${selected.status}`}
                    credentialId={selected.id}
                    maskedValue={selected.maskedValue}
                    canReveal={canViewValue}
                  />
                </div>
                <dl className="vault-properties">
                  <dt>说明</dt>
                  <dd>{selected.description ?? '无说明'}</dd>
                  <dt>过期时间</dt>
                  <dd>{selected.expiresAt ? formatDateTime(selected.expiresAt) : '长期有效'}</dd>
                </dl>
                {canManage ? (
                  <div className="row vault-actions">
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
                <h3>项目授权</h3>
                {selected.grants.length === 0 ? (
                  <p className="muted small">尚未授权项目。</p>
                ) : (
                  <ul className="plain-list vault-grants">
                    {selected.grants.map((grant) => (
                      <li key={grant.projectId} className="row spread">
                        <span>{grant.projectName}</span>
                        <span className="muted small">
                          {grant.expiresAt ? `${formatDateTime(grant.expiresAt)} 到期` : '长期有效'}
                        </span>
                        <span className="badge">{grant.revokedAt ? '已撤销' : '生效中'}</span>
                      </li>
                    ))}
                  </ul>
                )}
                <h3>使用记录</h3>
                {usage.isPending ? (
                  <DelayedLoading pending>
                    <PageLoading />
                  </DelayedLoading>
                ) : usage.isError || !usage.data ? (
                  <p className="muted small">使用记录不可用。</p>
                ) : usage.data.data.items.length === 0 ? (
                  <p className="muted small">暂无使用记录。</p>
                ) : (
                  <ul className="plain-list vault-usage">
                    {usage.data.data.items.map((item) => (
                      <li key={item.id} className="row spread">
                        <span>{formatDateTime(item.createdAt)}</span>
                        <span className="muted small">{USAGE_ACTION_LABELS[item.action] ?? item.action}</span>
                        <span className="muted small">{USAGE_RESULT_LABELS[item.result] ?? item.result}</span>
                        <span className="muted small">v{item.credentialVersion}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            ) : null}
          </section>
        </div>
      )}

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
