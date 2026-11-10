import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/shared/api/client'
import { describeRequestError } from '@/shared/api/errors'
import { formatDateTime } from '@/shared/lib/format'
import { Tag, type TagVariant } from '@/shared/ui/tag'
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
import { DelayedLoading } from '@/shared/ui/delayed-loading'
import { EmptyState, PageError, PageLoading } from '@/shared/ui/page-state'
import { useToast } from '@/shared/ui/toast'
import { gitConnectionsQueryOptions } from '../api/queries'

const PROVIDER_LABELS = { github: 'GitHub', gitea: 'Gitea' } as const
const AUTH_LABELS: Record<string, string> = {
  github_app_installation: 'GitHub App 安装',
  github_cli: 'GitHub CLI',
  gitea_token: 'Gitea Token',
}
const STATUS_LABELS: Record<string, { label: string; variant: TagVariant }> = {
  active: { label: '正常', variant: 'green' },
  invalid: { label: '失效', variant: 'red' },
  revoked: { label: '已撤销', variant: 'neutral' },
}
const EMPTY_GITEA_FORM = { name: '', instanceUrl: '', token: '' }

/**
 * 团队级 Git 连接管理：添加、检查、同步仓库和撤销连接。
 * GitHub App 安装授权由团队共享，成员无需各自绑定 GitHub 账号。
 * @param props.teamId 团队标识；canManage 当前用户是否具备管理员写权限。
 * @returns 连接列表、添加表单和撤销确认；非管理员为只读视图。
 */
export function TeamGitConnections({ teamId, canManage }: { teamId: string; canManage: boolean }) {
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const connections = useQuery(gitConnectionsQueryOptions(teamId))
  const [giteaForm, setGiteaForm] = useState(EMPTY_GITEA_FORM)
  const [error, setError] = useState('')
  const [revokeTarget, setRevokeTarget] = useState<{ id: string; name: string } | null>(null)
  const [revokeReason, setRevokeReason] = useState('')

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['code', 'connections', teamId] }),
      queryClient.invalidateQueries({ queryKey: ['code', 'connection-repositories'] }),
    ])
  }
  const handleError = (cause: unknown) => {
    const message = describeRequestError(cause).description
    setError(message)
    showToast(message, 'error')
  }

  const createGithub = useMutation({
    mutationFn: () => apiClient.createGitConnection(teamId, { providerKey: 'github' as const, name: 'GitHub' }),
    onSuccess: async (result) => {
      if ('authorizationUrl' in result.data) {
        window.location.assign(result.data.authorizationUrl)
        return
      }
      setError('')
      await invalidate()
      showToast('GitHub 连接已添加。', 'success')
    },
    onError: handleError,
  })
  const createGitea = useMutation({
    mutationFn: () =>
      apiClient.createGitConnection(teamId, {
        providerKey: 'gitea' as const,
        name: giteaForm.name.trim(),
        instanceUrl: giteaForm.instanceUrl.trim(),
        token: giteaForm.token,
      }),
    onSuccess: async () => {
      setGiteaForm(EMPTY_GITEA_FORM)
      setError('')
      await invalidate()
      showToast('Gitea 连接已添加。', 'success')
    },
    onError: handleError,
  })
  const checkConnection = useMutation({
    mutationFn: (connectionId: string) => apiClient.checkGitConnection(connectionId),
    onSuccess: async () => {
      setError('')
      await invalidate()
      showToast('连接检查完成。', 'success')
    },
    onError: handleError,
  })
  const syncRepositories = useMutation({
    mutationFn: (connectionId: string) => apiClient.syncGitRepositories(connectionId),
    onSuccess: async (result) => {
      setError('')
      await invalidate()
      showToast(`仓库同步完成，共 ${result.data.total} 个。`, 'success')
    },
    onError: handleError,
  })
  const revokeConnection = useMutation({
    mutationFn: async () => {
      if (!revokeTarget) throw new Error('缺少撤销目标')
      return apiClient.revokeGitConnection(revokeTarget.id, { reason: revokeReason.trim() })
    },
    onSuccess: async () => {
      setRevokeTarget(null)
      setRevokeReason('')
      setError('')
      await invalidate()
      showToast('Git 连接已撤销。', 'success')
    },
    onError: handleError,
  })

  if (connections.isPending) {
    return (
      <DelayedLoading pending>
        <PageLoading message="Git 连接加载中…" />
      </DelayedLoading>
    )
  }
  if (connections.isError) {
    const described = describeRequestError(connections.error)
    return (
      <PageError
        title="Git 连接加载失败"
        description={described.description}
        requestId={described.requestId}
        retrying={connections.isFetching}
        onRetry={() => void connections.refetch()}
      />
    )
  }

  const connectionItems = connections.data?.data ?? []
  const activeConnections = connectionItems.filter((connection) => connection.status !== 'revoked')
  const revokedConnections = connectionItems.filter((connection) => connection.status === 'revoked')

  return (
    <div className="repo-settings">
      <section className="card">
        <div className="section-heading">
          <h3>Git 连接</h3>
          <span className="spacer" />
          {canManage && (
            <Button variant="outline" size="sm" disabled={createGithub.isPending} onClick={() => createGithub.mutate()}>
              {createGithub.isPending ? '跳转中…' : '添加 GitHub 连接'}
            </Button>
          )}
        </div>
        <p className="section-note">
          GitHub App 安装授权是团队级共享授权，成员无需各自绑定 GitHub 账号。连接、检查和同步仓库仅管理员可操作。
        </p>
        {activeConnections.length === 0 ? (
          <EmptyState
            title="还没有可用的 Git 连接"
            description={
              canManage
                ? '添加 GitHub 或 Gitea 连接并同步仓库后，项目才能关联代码仓库。'
                : '请联系团队管理员添加并同步 Git 连接。'
            }
          />
        ) : (
          <div className="repo-list">
            {activeConnections.map((connection) => {
              const status = STATUS_LABELS[connection.status] ?? { label: connection.status, variant: 'neutral' }
              return (
                <div className="connection-item" key={connection.id}>
                  <div>
                    <div className="row">
                      <strong>{connection.name}</strong>
                      <Tag variant={status.variant}>{status.label}</Tag>
                    </div>
                    <p className="small quiet">
                      {PROVIDER_LABELS[connection.providerKey as keyof typeof PROVIDER_LABELS] ??
                        connection.providerKey}
                      {' · '}
                      {AUTH_LABELS[connection.authKind] ?? connection.authKind}
                      {' · '}
                      {connection.instanceUrl}
                    </p>
                    <p className="small quiet">
                      最近检查 {formatDateTime(connection.lastCheckedAt)}
                      {connection.lastErrorCode ? ` · ${connection.lastErrorCode}` : ''}
                    </p>
                  </div>
                  <span className="spacer" />
                  {canManage && (
                    <div className="row">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={checkConnection.isPending}
                        onClick={() => checkConnection.mutate(connection.id)}
                      >
                        {checkConnection.isPending && checkConnection.variables === connection.id ? '检查中…' : '检查'}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={syncRepositories.isPending}
                        onClick={() => syncRepositories.mutate(connection.id)}
                      >
                        {syncRepositories.isPending && syncRepositories.variables === connection.id
                          ? '同步中…'
                          : '同步仓库'}
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => {
                          setRevokeTarget({ id: connection.id, name: connection.name })
                          setRevokeReason('')
                        }}
                      >
                        撤销
                      </Button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
        {revokedConnections.length > 0 && (
          <details className="connection-form">
            <summary>已撤销连接（{revokedConnections.length}）</summary>
            <div className="repo-list">
              {revokedConnections.map((connection) => (
                <div className="connection-item" key={connection.id}>
                  <div>
                    <div className="row">
                      <strong>{connection.name}</strong>
                      <Tag>已撤销</Tag>
                    </div>
                    <p className="small quiet">
                      {connection.instanceUrl} · 最近检查 {formatDateTime(connection.lastCheckedAt)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </details>
        )}
        {canManage && (
          <details className="connection-form">
            <summary>添加 Gitea 连接</summary>
            <div className="form-grid">
              <label className="field">
                连接名称
                <Input
                  value={giteaForm.name}
                  maxLength={120}
                  placeholder="例如 Gitea 主站"
                  onChange={(event) => setGiteaForm((form) => ({ ...form, name: event.target.value }))}
                />
              </label>
              <label className="field">
                实例地址
                <Input
                  value={giteaForm.instanceUrl}
                  maxLength={2048}
                  placeholder="https://gitea.example.com"
                  onChange={(event) => setGiteaForm((form) => ({ ...form, instanceUrl: event.target.value }))}
                />
              </label>
              <label className="field full">
                访问 Token
                <Input
                  type="password"
                  value={giteaForm.token}
                  maxLength={100000}
                  placeholder="只保存服务端加密后的凭据"
                  onChange={(event) => setGiteaForm((form) => ({ ...form, token: event.target.value }))}
                />
              </label>
              <div className="form-actions field full">
                <Button
                  type="button"
                  disabled={
                    !giteaForm.name.trim() || !giteaForm.instanceUrl.trim() || !giteaForm.token || createGitea.isPending
                  }
                  onClick={() => createGitea.mutate()}
                >
                  {createGitea.isPending ? '添加中…' : '添加 Gitea 连接'}
                </Button>
              </div>
            </div>
          </details>
        )}
      </section>

      {error && (
        <p role="alert" className="field-error">
          {error}
        </p>
      )}

      <Dialog
        open={revokeTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRevokeTarget(null)
            setRevokeReason('')
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>撤销 Git 连接</DialogTitle>
            <DialogDescription>
              撤销后团队成员将无法再读取该连接下的仓库；已关联的仓库会失效，历史记录与审计保留。此操作不可自动恢复。
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault()
              if (!revokeReason.trim()) return
              revokeConnection.mutate()
            }}
          >
            <label className="block space-y-1.5 text-sm font-medium">
              撤销原因
              <Input
                value={revokeReason}
                readOnly={revokeConnection.isPending}
                maxLength={2000}
                placeholder={`说明撤销 ${revokeTarget?.name ?? ''} 的原因`}
                onChange={(event) => setRevokeReason(event.target.value)}
              />
            </label>
            {revokeConnection.isError && (
              <p role="alert" className="field-error">
                {describeRequestError(revokeConnection.error).description}
              </p>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={revokeConnection.isPending}
                onClick={() => setRevokeTarget(null)}
              >
                取消
              </Button>
              <Button type="submit" variant="destructive" disabled={!revokeReason.trim() || revokeConnection.isPending}>
                {revokeConnection.isPending ? '撤销中…' : '确认撤销'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
