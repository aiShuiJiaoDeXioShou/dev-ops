import { useMemo, useState, type FormEvent } from 'react'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router'
import { Check, Copy, FileText, KeyRound, Plus, Search, ShieldCheck, SlidersHorizontal } from 'lucide-react'
import { useSession } from '@/features/identity/model/session'
import { apiClient } from '@/shared/api/client'
import { describeRequestError } from '@/shared/api/errors'
import { isNestedInteractiveTarget } from '@/shared/lib/clickable'
import { formatDateTime } from '@/shared/lib/format'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/shared/ui/controls/alert-dialog'
import { Badge } from '@/shared/ui/controls/badge'
import { Button } from '@/shared/ui/controls/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/controls/dialog'
import { Input } from '@/shared/ui/controls/input'
import { Select } from '@/shared/ui/controls/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/controls/table'
import { TableSkeleton } from '@/shared/ui/page-skeleton'
import { EmptyState, PageError } from '@/shared/ui/page-state'
import { StatusBadge } from '@/shared/ui/status-badge'
import { useToast } from '@/shared/ui/toast'
import { credentialsQueryOptions, envVariablesQueryOptions } from '../api/queries'
import './environment-variables.css'

const ENVIRONMENTS = [
  { value: 'development', label: '开发' },
  { value: 'test', label: '测试' },
  { value: 'production', label: '生产' },
] as const

type Environment = (typeof ENVIRONMENTS)[number]['value']
type VarKind = 'plain' | 'credential_ref'

const ENV_PARAM = 'env'
const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/
const EMPTY_FORM = { name: '', kind: 'plain' as VarKind, value: '', credentialId: '' }

const INVALID_REASON_LABELS: Record<string, string> = {
  credential_missing: '凭据已删除',
  credential_revoked: '凭据已吊销',
  credential_expired: '凭据已过期',
  grant_revoked: '项目授权已撤销',
  grant_expired: '项目授权已过期',
}

const CREDENTIAL_STATUS_LABELS: Record<string, string> = {
  active: '可用',
  expired: '已过期',
  revoked: '已吊销',
}

function parseEnvironmentParam(value: string | null): Environment {
  if (value === 'test' || value === 'production') return value
  return 'development'
}

function formatInvalidReason(reason: string | null): string {
  if (!reason) return '待核对'
  return INVALID_REASON_LABELS[reason] ?? reason
}

/**
 * 项目环境变量管理组件。
 *
 * 按开发、测试、生产三套环境隔离展示配置，支持 URL 同步切换、类型/状态/关键词筛选、
 * 普通变量值快捷复制、凭据引用版本追踪、失效原因中文化及二次确认删除。
 * @param props.projectId 项目标识。
 * @returns 项目环境变量工作台界面。
 */
export function EnvironmentVariables({ projectId }: { projectId: string }) {
  const { currentTeam, role } = useSession()
  const canManage = role === 'admin' || role === 'developer'
  const teamId = currentTeam?.id ?? ''
  const [searchParams, setSearchParams] = useSearchParams()
  const queryClient = useQueryClient()
  const { showToast } = useToast()

  const environment = parseEnvironmentParam(searchParams.get(ENV_PARAM))
  const [kindFilter, setKindFilter] = useState<'all' | VarKind>('all')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'invalid'>('all')
  const [keyword, setKeyword] = useState('')
  const [copiedId, setCopiedId] = useState('')

  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [formError, setFormError] = useState('')
  const [editingId, setEditingId] = useState('')
  const [editingVersion, setEditingVersion] = useState(1)
  const [removeTarget, setRemoveTarget] = useState<{ id: string; name: string } | null>(null)
  const [removeReason, setRemoveReason] = useState('')
  const [removeError, setRemoveError] = useState('')

  const variables = useQuery(envVariablesQueryOptions(projectId, environment))
  // 三个环境各取一次，页签上显示配置数量，避免用户停在空环境里看不到其他环境已有数据。
  const environmentQueries = useQueries({
    queries: ENVIRONMENTS.map((item) => envVariablesQueryOptions(projectId, item.value)),
  })
  const environmentCounts = new Map(
    ENVIRONMENTS.map((item, index) => [item.value, environmentQueries[index]?.data?.data.items.length ?? 0]),
  )
  const configuredElsewhere = ENVIRONMENTS.filter(
    (item) => item.value !== environment && (environmentCounts.get(item.value) ?? 0) > 0,
  )
  const credentials = useQuery({
    ...credentialsQueryOptions(teamId, { page: 1, pageSize: 100 }),
    enabled: Boolean(teamId),
  })

  const changeEnvironment = (next: Environment) => {
    const params = new URLSearchParams(searchParams)
    if (next === 'development') params.delete(ENV_PARAM)
    else params.set(ENV_PARAM, next)
    setSearchParams(params)
    setKindFilter('all')
    setStatusFilter('all')
    setKeyword('')
  }

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['configuration', 'env-vars', projectId] })
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
      setFormError('')
      setEditingId('')
      showToast('环境变量已保存。', 'success')
    },
    onError: (error: unknown) => {
      const description = describeRequestError(error).description
      setFormError(description)
      showToast(description, 'error')
    },
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
      setRemoveError('')
      showToast('环境变量已删除。', 'success')
    },
    onError: (error: unknown) => {
      const description = describeRequestError(error).description
      setRemoveError(description)
      showToast(description, 'error')
    },
  })

  const openCreate = () => {
    setForm(EMPTY_FORM)
    setFormError('')
    setEditingId('')
    setFormOpen(true)
  }

  const openEdit = (input: {
    id: string
    name: string
    version: number
    kind: string
    masked: boolean
    valuePreview: string | null
    credentialId?: string | null
  }) => {
    const kind: VarKind = input.kind === 'credential_ref' ? 'credential_ref' : 'plain'
    setForm({
      name: input.name,
      kind,
      value: kind === 'plain' && !input.masked ? (input.valuePreview ?? '') : '',
      credentialId: input.credentialId ?? '',
    })
    setFormError('')
    setEditingId(input.id)
    setEditingVersion(input.version)
    setFormOpen(true)
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    setFormError('')
    const trimmedName = form.name.trim()
    if (!trimmedName) {
      setFormError('请填写变量名称。')
      return
    }
    if (!editingId && !ENV_NAME_PATTERN.test(trimmedName)) {
      setFormError('变量名称仅支持字母、数字与下划线，且须以字母或下划线开头。')
      return
    }
    if (form.kind === 'plain' && !form.value) {
      setFormError('请填写普通变量值。')
      return
    }
    if (form.kind === 'credential_ref' && !form.credentialId) {
      setFormError('请选择已授权凭据。')
      return
    }
    save.mutate()
  }

  const copyPlainValue = async (id: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value)
      setCopiedId(id)
      showToast('已复制变量值。', 'success')
      setTimeout(() => setCopiedId((prev) => (prev === id ? '' : prev)), 1500)
    } catch {
      showToast('剪贴板不可用，请手动选择复制。', 'error')
    }
  }

  const items = variables.data?.data.items ?? []
  const plainCount = items.filter((item) => item.kind === 'plain').length
  const secretCount = items.filter((item) => item.kind === 'credential_ref').length
  const invalidCount = items.filter((item) => item.status !== 'active').length

  const filteredItems = useMemo(() => {
    const q = keyword.trim().toLowerCase()
    return items.filter((item) => {
      if (kindFilter !== 'all' && item.kind !== kindFilter) return false
      if (statusFilter === 'active' && item.status !== 'active') return false
      if (statusFilter === 'invalid' && item.status === 'active') return false
      if (!q) return true
      const credName = item.credential?.name ?? ''
      const preview = item.masked ? '' : (item.valuePreview ?? '')
      return `${item.name} ${preview} ${credName}`.toLowerCase().includes(q)
    })
  }, [items, kindFilter, statusFilter, keyword])

  const hasFilter = kindFilter !== 'all' || statusFilter !== 'all' || keyword.trim().length > 0
  const envLabel = ENVIRONMENTS.find((item) => item.value === environment)?.label ?? environment

  if (variables.isPending) {
    return (
      <TableSkeleton
        toolbar
        rows={5}
        columns={['24%', '28%', '14%', '16%', '18%']}
        label="环境变量加载中"
        className="project-tab-panel"
      />
    )
  }
  if (variables.isError && !variables.data) {
    return (
      <PageError
        title="环境变量加载失败"
        error={variables.error}
        retrying={variables.isFetching}
        retryLabel="重新加载"
        onRetry={() => void variables.refetch()}
      />
    )
  }

  return (
    <div className="project-tab-panel">
      <div className="env-root">
        <div className="env-top-bar">
          <div className="segments" role="tablist" aria-label="环境">
            {ENVIRONMENTS.map((item) => (
              <Button
                key={item.value}
                type="button"
                variant={environment === item.value ? 'secondary' : 'ghost'}
                size="sm"
                role="tab"
                aria-selected={environment === item.value}
                onClick={() => changeEnvironment(item.value)}
              >
                {item.label}
                <span className="segment-count">{environmentCounts.get(item.value) ?? 0}</span>
              </Button>
            ))}
          </div>

          <div className="env-top-actions">
            <Button asChild variant="outline" size="sm">
              <Link to="/vault">
                <KeyRound size={14} aria-hidden="true" />
                团队凭据库
              </Link>
            </Button>
            {canManage ? (
              <Button type="button" size="sm" onClick={openCreate}>
                <Plus size={14} aria-hidden="true" />
                新增配置
              </Button>
            ) : null}
          </div>
        </div>

        <div className="env-metrics" aria-label="当前环境配置概览">
          <div className="env-metric-card">
            <span className="env-metric-label">{envLabel}环境配置</span>
            <span className="env-metric-value">{items.length}</span>
          </div>
          <div className="env-metric-card">
            <span className="env-metric-label">普通变量</span>
            <span className="env-metric-value">{plainCount}</span>
          </div>
          <div className="env-metric-card">
            <span className="env-metric-label">密钥引用</span>
            <span className="env-metric-value">{secretCount}</span>
          </div>
          <div className="env-metric-card">
            <span className="env-metric-label">待处理失效项</span>
            <span className={`env-metric-value ${invalidCount > 0 ? 'danger' : ''}`}>{invalidCount}</span>
          </div>
        </div>

        <div className="env-security-banner">
          <ShieldCheck size={15} className="shrink-0 text-muted-foreground" aria-hidden="true" />
          <span>
            开发、测试、生产三套环境严格隔离，不自动继承；敏感密钥统一通过团队凭据引用在流水线运行时注入，页面不回显明文。
          </span>
        </div>

        {items.length > 0 ? (
          <div className="env-filter-bar">
            <div className="env-filter-selects">
              <Select
                aria-label="按变量类型筛选"
                className="env-filter-select"
                value={kindFilter}
                onChange={(event) => setKindFilter(event.target.value as 'all' | VarKind)}
              >
                <option value="all">全部类型</option>
                <option value="plain">普通变量</option>
                <option value="credential_ref">密钥引用</option>
              </Select>

              <Select
                aria-label="按状态筛选变量"
                className="env-filter-select"
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value as 'all' | 'active' | 'invalid')}
              >
                <option value="all">全部状态</option>
                <option value="active">可用</option>
                <option value="invalid">失效</option>
              </Select>

              {hasFilter ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setKindFilter('all')
                    setStatusFilter('all')
                    setKeyword('')
                  }}
                >
                  清除筛选
                </Button>
              ) : null}
            </div>

            <div className="env-search-wrap">
              <Search size={13} className="env-search-icon" aria-hidden="true" />
              <Input
                aria-label="搜索环境变量"
                className="env-search-input"
                placeholder="搜索变量名、值或凭据…"
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
              />
            </div>
          </div>
        ) : null}

        {items.length === 0 ? (
          <EmptyState
            mascot="prism"
            title="这个环境还没有配置"
            description={
              configuredElsewhere.length > 0
                ? `${envLabel}环境暂无配置；${configuredElsewhere.map((item) => item.label).join('、')}环境已有配置，可直接切换查看。`
                : `为${envLabel}环境添加普通配置或引用团队凭据，流水线与服务将按环境隔离读取。`
            }
            action={
              <div className="env-empty-jumps">
                {configuredElsewhere.map((other) => (
                  <Button
                    key={other.value}
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => changeEnvironment(other.value)}
                  >
                    查看{other.label}环境（{environmentCounts.get(other.value) ?? 0}）
                  </Button>
                ))}
                {canManage ? (
                  <Button type="button" size="sm" onClick={openCreate}>
                    新增配置
                  </Button>
                ) : null}
              </div>
            }
          />
        ) : filteredItems.length === 0 ? (
          <EmptyState
            icon={<SlidersHorizontal />}
            title="没有匹配的环境变量"
            description="当前筛选或搜索条件下没有找到变量，可放宽类型、状态条件或清空关键词。"
            action={
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setKindFilter('all')
                  setStatusFilter('all')
                  setKeyword('')
                }}
              >
                清除筛选
              </Button>
            }
          />
        ) : (
          <div className="table-wrap">
            <Table aria-label={`${envLabel}环境变量列表`}>
              <TableHeader>
                <TableRow>
                  <TableHead>变量名称</TableHead>
                  <TableHead>值 / 引用凭据</TableHead>
                  <TableHead>类型</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>更新时间</TableHead>
                  {canManage ? <TableHead>操作</TableHead> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredItems.map((item) => {
                  const isSecretRef = item.kind === 'credential_ref'
                  const canCopyPlain = !isSecretRef && !item.masked && Boolean(item.valuePreview)
                  return (
                    <TableRow
                      key={item.id}
                      className={canManage ? 'clickable-row' : undefined}
                      onClick={(event) => {
                        if (!canManage || isNestedInteractiveTarget(event.target)) return
                        openEdit({
                          id: item.id,
                          name: item.name,
                          version: item.version,
                          kind: item.kind,
                          masked: item.masked,
                          valuePreview: item.valuePreview,
                          credentialId: item.credential?.id,
                        })
                      }}
                    >
                      <TableCell>
                        <span className="env-name-cell">
                          <strong className="mono">{item.name}</strong>
                          <Badge variant="outline" className="mono">
                            v{item.version}
                          </Badge>
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className="env-value-cell">
                          {isSecretRef ? (
                            <>
                              <span className="env-value-text masked">••••••••</span>
                              {item.credential ? (
                                <span className="env-cred-chip" title={`团队凭据：${item.credential.name}`}>
                                  <KeyRound size={12} className="text-muted-foreground" aria-hidden="true" />
                                  <span>{item.credential.name}</span>
                                  <span className="mono text-muted-foreground">v{item.credential.currentVersion}</span>
                                </span>
                              ) : (
                                <span className="text-xs text-destructive">关联凭据已失效</span>
                              )}
                            </>
                          ) : (
                            <>
                              <span
                                className={`env-value-text ${item.masked ? 'masked' : ''}`}
                                title={item.masked ? '已脱敏' : (item.valuePreview ?? '')}
                              >
                                {item.masked ? '••••••••' : (item.valuePreview ?? '—')}
                              </span>
                              {canCopyPlain ? (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon-sm"
                                  aria-label={`复制 ${item.name} 的值`}
                                  onClick={() => void copyPlainValue(item.id, item.valuePreview ?? '')}
                                >
                                  {copiedId === item.id ? (
                                    <Check size={12} className="text-primary" aria-hidden="true" />
                                  ) : (
                                    <Copy size={12} aria-hidden="true" />
                                  )}
                                </Button>
                              ) : null}
                            </>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="env-kind-chip">
                          {isSecretRef ? (
                            <>
                              <KeyRound size={13} aria-hidden="true" />
                              密钥引用
                            </>
                          ) : (
                            <>
                              <FileText size={13} aria-hidden="true" />
                              普通变量
                            </>
                          )}
                        </span>
                      </TableCell>
                      <TableCell>
                        <StatusBadge tone={item.status === 'active' ? 'success' : 'danger'}>
                          {item.status === 'active' ? '可用' : `失效（${formatInvalidReason(item.invalidReason)}）`}
                        </StatusBadge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{formatDateTime(item.updatedAt)}</TableCell>
                      {canManage ? (
                        <TableCell>
                          <div className="env-row-actions">
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                openEdit({
                                  id: item.id,
                                  name: item.name,
                                  version: item.version,
                                  kind: item.kind,
                                  masked: item.masked,
                                  valuePreview: item.valuePreview,
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
                              onClick={() => {
                                setRemoveReason('')
                                setRemoveError('')
                                setRemoveTarget({ id: item.id, name: item.name })
                              }}
                            >
                              删除
                            </Button>
                          </div>
                        </TableCell>
                      ) : null}
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent>
          <form className="space-y-4" onSubmit={submit}>
            <DialogHeader>
              <DialogTitle>{editingId ? '编辑环境变量' : '新增环境变量'}</DialogTitle>
              <DialogDescription>
                目标环境：<strong className="text-foreground">{envLabel}环境</strong>
                {editingId ? ` · 当前版本 v${editingVersion}` : ' · 仅对当前所选环境生效'}
              </DialogDescription>
            </DialogHeader>

            {formError ? (
              <p className="field-error" role="alert">
                {formError}
              </p>
            ) : null}

            <label className="block space-y-1.5 text-sm font-medium">
              名称
              <Input
                value={form.name}
                maxLength={120}
                readOnly={Boolean(editingId)}
                placeholder="例如 API_BASE_URL"
                onChange={(event) => setForm({ ...form, name: event.target.value })}
              />
              <span className="block text-xs font-normal text-muted-foreground">
                {editingId
                  ? '编辑时不可修改变量名，如需改名请删除后重新创建。'
                  : '仅支持字母、数字与下划线，且以字母或下划线开头。'}
              </span>
            </label>

            <label className="block space-y-1.5 text-sm font-medium">
              类型
              <Select
                value={form.kind}
                disabled={Boolean(editingId)}
                onChange={(event) => setForm({ ...form, kind: event.target.value as VarKind })}
              >
                <option value="plain">普通变量</option>
                <option value="credential_ref">团队凭据引用</option>
              </Select>
            </label>

            {form.kind === 'plain' ? (
              <label className="block space-y-1.5 text-sm font-medium">
                变量值（敏感值请改用团队凭据引用）
                <Input
                  value={form.value}
                  placeholder="输入非敏感配置值"
                  onChange={(event) => setForm({ ...form, value: event.target.value })}
                />
              </label>
            ) : (
              <label className="block space-y-1.5 text-sm font-medium">
                团队凭据
                <Select
                  value={form.credentialId}
                  onChange={(event) => setForm({ ...form, credentialId: event.target.value })}
                >
                  <option value="">选择已授权凭据</option>
                  {credentials.data?.data.items.map((credential) => (
                    <option key={credential.id} value={credential.id}>
                      {credential.name}（v{credential.currentVersion} ·{' '}
                      {CREDENTIAL_STATUS_LABELS[credential.status] ?? credential.status}）
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

      <AlertDialog
        open={removeTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRemoveTarget(null)
            setRemoveError('')
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除环境变量</AlertDialogTitle>
            <AlertDialogDescription>
              确定从{envLabel}环境删除 <strong className="mono text-foreground">{removeTarget?.name}</strong>？
              依赖该变量的流水线或部署将无法读取此配置。
            </AlertDialogDescription>
          </AlertDialogHeader>
          {removeError ? (
            <p className="field-error" role="alert">
              {removeError}
            </p>
          ) : null}
          <label className="block space-y-1.5 text-sm font-medium">
            删除原因
            <Input
              value={removeReason}
              maxLength={1000}
              placeholder="例如：配置已迁移至新变量名"
              onChange={(event) => setRemoveReason(event.target.value)}
            />
          </label>
          <AlertDialogFooter>
            <AlertDialogCancel asChild>
              <Button type="button" variant="outline" disabled={remove.isPending}>
                取消
              </Button>
            </AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button
                type="button"
                variant="destructive"
                disabled={remove.isPending}
                onClick={(event) => {
                  event.preventDefault()
                  if (!removeReason.trim()) {
                    setRemoveError('请填写删除原因，便于审计追溯。')
                    return
                  }
                  remove.mutate()
                }}
              >
                {remove.isPending ? '删除中…' : '确认删除'}
              </Button>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
