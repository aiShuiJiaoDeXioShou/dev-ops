import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { isBusinessError } from '@dev-ops/api-client'
import { apiClient } from '@/shared/api/client'
import { useToast } from '@/shared/ui/toast'
import { Button } from '@/shared/ui/controls/button'
import { Input } from '@/shared/ui/controls/input'
import { Select } from '@/shared/ui/controls/select'
import { formatDateTime } from '@/shared/lib/format'
import { Tag } from '@/shared/ui/tag'
import {
  availableRepositoriesQueryOptions,
  gitConnectionsQueryOptions,
  projectRepositoriesQueryOptions,
} from '../api/queries'

/** 项目仓库选择与 Git 连接管理。 */
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
  const link = useMutation({
    mutationFn: () => apiClient.linkRepository(projectId, { repositoryId }),
    onSuccess: invalidate,
    onError: (cause: unknown) => {
      const message = isBusinessError(cause) ? cause.message : '仓库关联失败。'
      setError(message)
      showToast(message, 'error')
    },
  })
  const createGithub = useMutation({
    mutationFn: () => apiClient.createGitConnection(teamId, { providerKey: 'github' as const, name: 'GitHub' }),
    onSuccess: async (result) => {
      if ('authorizationUrl' in result.data) window.location.assign(result.data.authorizationUrl)
      else await invalidate()
    },
    onError: (cause: unknown) => {
      const message = isBusinessError(cause) ? cause.message : 'GitHub 连接创建失败。'
      setError(message)
      showToast(message, 'error')
    },
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
      await invalidate()
    },
    onError: (cause: unknown) => {
      const message = isBusinessError(cause) ? cause.message : '连接创建失败。'
      setError(message)
      showToast(message, 'error')
    },
  })
  return (
    <div className="space-y-5">
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">已关联仓库</h2>
        {projectRepos.data?.data.length ? (
          <ul className="space-y-2">
            {projectRepos.data.data.map((repo) => (
              <li key={repo.id} className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm">
                <a className="text-primary hover:underline" href={repo.webUrl} target="_blank" rel="noreferrer">
                  {repo.namespace}/{repo.name}
                </a>
                <Tag variant={repo.status === 'available' ? 'green' : 'red'}>{repo.status}</Tag>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">尚未关联仓库。</p>
        )}
      </section>
      {canManage && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">关联可用仓库</h2>
          <div className="flex flex-wrap gap-2">
            <Select className="min-w-64" value={repositoryId} onChange={(event) => setRepositoryId(event.target.value)}>
              <option value="">选择仓库</option>
              {(available.data?.data.items ?? []).map((repo) => (
                <option key={repo.id} value={repo.id}>
                  {repo.namespace}/{repo.name}
                </option>
              ))}
            </Select>
            <Button type="button" disabled={!repositoryId || link.isPending} onClick={() => link.mutate()}>
              关联仓库
            </Button>
          </div>
        </section>
      )}
      {canManage && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Git 连接</h2>
          {connections.data?.data.length ? (
            <ul className="space-y-2">
              {connections.data.data.map((connection) => (
                <li
                  key={connection.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm"
                >
                  <span>
                    {connection.name} · {connection.providerKey} ·{' '}
                    <Tag variant={connection.status === 'ok' ? 'green' : 'red'}>{connection.status}</Tag>
                  </span>
                  <span className="text-xs text-muted-foreground">检查 {formatDateTime(connection.lastCheckedAt)}</span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      await apiClient.checkGitConnection(connection.id)
                      await invalidate()
                    }}
                  >
                    检查
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      await apiClient.syncGitRepositories(connection.id)
                      await invalidate()
                    }}
                  >
                    同步仓库
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">还没有 Git 连接。</p>
          )}
          <div className="grid gap-2 rounded-lg border p-3 sm:grid-cols-4">
            <Input placeholder="连接名称" value={name} onChange={(event) => setName(event.target.value)} />
            <Input
              placeholder="Gitea 实例地址"
              value={instanceUrl}
              onChange={(event) => setInstanceUrl(event.target.value)}
            />
            <Input
              type="password"
              placeholder="Token"
              value={token}
              onChange={(event) => setToken(event.target.value)}
            />
            <Button
              type="button"
              disabled={!name.trim() || !instanceUrl.trim() || !token || createConnection.isPending}
              onClick={() => createConnection.mutate()}
            >
              添加 Gitea 连接
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={createGithub.isPending}
              onClick={() => createGithub.mutate()}
            >
              添加 GitHub 连接
            </Button>
          </div>
        </section>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
