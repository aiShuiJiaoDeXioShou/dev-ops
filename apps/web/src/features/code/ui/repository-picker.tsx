import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/shared/api/client'
import { describeRequestError } from '@/shared/api/errors'
import { useToast } from '@/shared/ui/toast'
import { formatDateTime } from '@/shared/lib/format'
import { Tag } from '@/shared/ui/tag'
import {
  availableRepositoriesQueryOptions,
  gitConnectionsQueryOptions,
  projectRepositoriesQueryOptions,
} from '../api/queries'

const PROVIDER_LABELS = { github: 'GitHub', gitea: 'Gitea' } as const

/**
 * 项目代码仓库与 Git 连接的设置区。
 * @param props.projectId 项目标识；teamId 团队标识；canManage 是否允许修改。
 * @returns 已关联仓库、可用仓库和 Git 连接的卡片式管理界面。
 */
export function RepositoryPicker({
  projectId,
  teamId,
  canManage,
}: {
  projectId: string
  teamId: string
  canManage: boolean
}) {
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const projectRepos = useQuery(projectRepositoriesQueryOptions(projectId))
  const available = useQuery(availableRepositoriesQueryOptions(projectId))
  const connections = useQuery(gitConnectionsQueryOptions(teamId))
  const [repositoryId, setRepositoryId] = useState('')
  const [instanceUrl, setInstanceUrl] = useState('')
  const [token, setToken] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['code', 'project-repositories', projectId] }),
      queryClient.invalidateQueries({ queryKey: ['code', 'available-repositories', projectId] }),
      queryClient.invalidateQueries({ queryKey: ['code', 'connections', teamId] }),
    ])
  }
  const handleError = (cause: unknown) => {
    const message = describeRequestError(cause).description
    setError(message)
    showToast(message, 'error')
  }
  const link = useMutation({
    mutationFn: () => apiClient.linkRepository(projectId, { repositoryId }),
    onSuccess: async () => {
      setError('')
      await invalidate()
      showToast('仓库已关联', 'success')
    },
    onError: handleError,
  })
  const createGithub = useMutation({
    mutationFn: () => apiClient.createGitConnection(teamId, { providerKey: 'github' as const, name: 'GitHub' }),
    onSuccess: async (result) => {
      if ('authorizationUrl' in result.data) window.location.assign(result.data.authorizationUrl)
      else {
        await invalidate()
        showToast('GitHub 连接已添加', 'success')
      }
    },
    onError: handleError,
  })
  const createConnection = useMutation({
    mutationFn: () =>
      apiClient.createGitConnection(teamId, {
        providerKey: 'gitea' as const,
        name: name.trim(),
        instanceUrl: instanceUrl.trim(),
        token,
      }),
    onSuccess: async () => {
      setInstanceUrl('')
      setToken('')
      setName('')
      setError('')
      await invalidate()
      showToast('Gitea 连接已添加', 'success')
    },
    onError: handleError,
  })
  const checkConnection = useMutation({
    mutationFn: (connectionId: string) => apiClient.checkGitConnection(connectionId),
    onSuccess: async () => {
      setError('')
      await invalidate()
      showToast('连接检查完成', 'success')
    },
    onError: handleError,
  })
  const syncConnection = useMutation({
    mutationFn: (connectionId: string) => apiClient.syncGitRepositories(connectionId),
    onSuccess: async () => {
      setError('')
      await invalidate()
      showToast('仓库同步完成', 'success')
    },
    onError: handleError,
  })
  const repositories = projectRepos.data?.data ?? []
  const availableRepositories = available.data?.data.items ?? []
  const connectionItems = connections.data?.data ?? []
  return (
    <div className="repo-settings">
      <section className="card">
        <div className="section-heading">
          <h3>已关联仓库</h3>
          <span className="spacer" />
          <Tag>{repositories.length} 个</Tag>
        </div>
        {repositories.length === 0 ? (
          <p className="section-note">尚未关联仓库。关联后可以在需求和 Bug 中添加代码引用。</p>
        ) : (
          <div className="repo-list">
            {repositories.map((repo) => (
              <div className="repo-row" key={repo.id}>
                <div>
                  <a className="repo-name" href={repo.webUrl} target="_blank" rel="noreferrer">
                    {repo.namespace}/{repo.name}
                  </a>
                  <p className="small quiet">项目仓库 · {repo.defaultBranch}</p>
                </div>
                <span className="spacer" />
                <Tag variant={repo.status === 'available' ? 'green' : 'red'}>{repo.status}</Tag>
              </div>
            ))}
          </div>
        )}
      </section>

      {canManage && (
        <section className="card">
          <div className="section-heading">
            <h3>关联可用仓库</h3>
          </div>
          {availableRepositories.length === 0 ? (
            <p className="section-note">当前没有可用仓库。请先在下方添加并同步 Git 连接。</p>
          ) : (
            <div className="repo-link-row">
              <label className="field repo-select">
                仓库
                <select value={repositoryId} onChange={(event) => setRepositoryId(event.target.value)}>
                  <option value="">选择仓库</option>
                  {availableRepositories.map((repo) => (
                    <option key={repo.id} value={repo.id}>
                      {repo.namespace}/{repo.name}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="btn primary"
                disabled={!repositoryId || link.isPending}
                onClick={() => link.mutate()}
              >
                {link.isPending ? '关联中…' : '关联仓库'}
              </button>
            </div>
          )}
        </section>
      )}

      {canManage && (
        <section className="card">
          <div className="section-heading">
            <h3>Git 连接</h3>
            <span className="spacer" />
            <button
              type="button"
              className="btn"
              disabled={createGithub.isPending}
              onClick={() => createGithub.mutate()}
            >
              添加 GitHub 连接
            </button>
          </div>
          {connectionItems.length === 0 ? (
            <p className="section-note">还没有 Git 连接。添加连接并同步后，才能把仓库关联到项目。</p>
          ) : (
            <div className="repo-list">
              {connectionItems.map((connection) => (
                <div className="connection-item" key={connection.id}>
                  <div>
                    <div className="row">
                      <strong>{connection.name}</strong>
                      <Tag variant={connection.status === 'ok' ? 'green' : 'red'}>{connection.status}</Tag>
                    </div>
                    <p className="small quiet">
                      {PROVIDER_LABELS[connection.providerKey as keyof typeof PROVIDER_LABELS] ??
                        connection.providerKey}
                      {' · '}
                      {connection.instanceUrl}
                      {' · '}
                      最近检查 {formatDateTime(connection.lastCheckedAt)}
                    </p>
                  </div>
                  <span className="spacer" />
                  <div className="row">
                    <button
                      type="button"
                      className="btn"
                      disabled={checkConnection.isPending}
                      onClick={() => checkConnection.mutate(connection.id)}
                    >
                      检查
                    </button>
                    <button
                      type="button"
                      className="btn"
                      disabled={syncConnection.isPending}
                      onClick={() => syncConnection.mutate(connection.id)}
                    >
                      同步仓库
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <details className="connection-form">
            <summary>添加 Gitea 连接</summary>
            <div className="form-grid">
              <label className="field">
                连接名称
                <input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如 Gitea 主站" />
              </label>
              <label className="field">
                实例地址
                <input
                  value={instanceUrl}
                  onChange={(event) => setInstanceUrl(event.target.value)}
                  placeholder="https://gitea.example.com"
                />
              </label>
              <label className="field full">
                访问 Token
                <input
                  type="password"
                  value={token}
                  onChange={(event) => setToken(event.target.value)}
                  placeholder="只保存服务端加密后的凭据"
                />
              </label>
              <div className="form-actions field full">
                <button
                  type="button"
                  className="btn primary"
                  disabled={!name.trim() || !instanceUrl.trim() || !token || createConnection.isPending}
                  onClick={() => createConnection.mutate()}
                >
                  {createConnection.isPending ? '添加中…' : '添加 Gitea 连接'}
                </button>
              </div>
            </div>
          </details>
        </section>
      )}
      {error && (
        <p role="alert" className="field-error">
          {error}
        </p>
      )}
    </div>
  )
}
