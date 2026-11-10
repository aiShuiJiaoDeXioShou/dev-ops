import { useState } from 'react'
import { useParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { PrototypeIcon } from '@/prototype/icons/icon'
import { useSession } from '@/features/identity/public'
import { projectQueryOptions } from '@/features/projects/public'
import {
  projectRepositoriesQueryOptions,
  repositoryBranchesQueryOptions,
  repositoryFileQueryOptions,
  repositoryTreeQueryOptions,
  RepositoryPicker,
} from '@/features/code/public'
import { describeRequestError } from '@/shared/api/errors'
import { PageError } from '@/shared/ui/page-state'
import { PageSkeleton } from '@/shared/ui/page-skeleton'
import { useToast } from '@/shared/ui/toast'

/**
 * 项目代码页：按原型的 Git 信息条和文件浏览器展示远端仓库内容。
 * @returns 代码阅读界面；未关联仓库时显示仓库管理。
 */
export function Component() {
  const { projectId = '' } = useParams()
  const { role } = useSession()
  const { showToast } = useToast()
  const canManage = role === 'admin' || role === 'developer'
  const project = useQuery(projectQueryOptions(projectId))
  const repositories = useQuery(projectRepositoriesQueryOptions(projectId))
  const [selectedRepositoryId, setSelectedRepositoryId] = useState('')
  const [selectedBranch, setSelectedBranch] = useState('')
  const [selectedPath, setSelectedPath] = useState('')
  const linkedRepositories = repositories.data?.data ?? []
  const repository = linkedRepositories.find((item) => item.id === selectedRepositoryId) ?? linkedRepositories[0]
  const branches = useQuery(repositoryBranchesQueryOptions(projectId, repository?.id ?? ''))
  const branchOptions = branches.data?.data.branches ?? (repository?.defaultBranch ? [repository.defaultBranch] : [])
  const branch = selectedBranch || repository?.defaultBranch || branchOptions[0] || undefined
  const tree = useQuery(repositoryTreeQueryOptions(projectId, repository?.id ?? '', branch))
  const files = (tree.data?.data.entries ?? []).filter((entry) => entry.type === 'file').map((entry) => entry.path)
  const defaultPath = files.find((path) => path.toLowerCase() === 'readme.md') ?? files[0] ?? ''
  const activePath = files.includes(selectedPath) ? selectedPath : defaultPath
  const file = useQuery(repositoryFileQueryOptions(projectId, repository?.id ?? '', tree.data?.data.branch, activePath))
  if (project.isPending || repositories.isPending) return <PageSkeleton />
  if (project.isError || !project.data) {
    const described = describeRequestError(project.error)
    return (
      <div className="catalog">
        <PageError
          title="项目加载失败"
          description={described.description}
          requestId={described.requestId}
          onRetry={() => void project.refetch()}
        />
      </div>
    )
  }
  if (!repository) {
    return (
      <div className="catalog">
        <RepositoryPicker projectId={projectId} teamId={project.data.data.teamId} canManage={canManage} />
      </div>
    )
  }
  const providerLabel =
    repository.providerKey === 'github'
      ? 'GitHub'
      : repository.providerKey === 'gitea'
        ? 'Gitea'
        : repository.providerKey
  const copyContent = async () => {
    if (!file.data) return
    try {
      await navigator.clipboard.writeText(file.data.data.content)
      showToast('文件内容已复制', 'success')
    } catch {
      showToast('浏览器拒绝剪贴板权限，请手动选择内容', 'error')
    }
  }
  const downloadContent = () => {
    if (!file.data) return
    const url = URL.createObjectURL(new Blob([file.data.data.content], { type: 'text/plain;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = activePath.split('/').at(-1) ?? 'file.txt'
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }
  return (
    <div className="catalog code-overview-page">
      <div className="git-strip">
        <PrototypeIcon name="branch" />
        <select
          aria-label="代码分支"
          value={tree.data?.data.branch ?? branch ?? ''}
          onChange={(event) => {
            setSelectedBranch(event.target.value)
            setSelectedPath('')
          }}
        >
          {branchOptions.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
        <span className="divider" />
        <PrototypeIcon name="repo" />
        {linkedRepositories.length > 1 ? (
          <select
            aria-label="选择仓库"
            value={repository.id}
            onChange={(event) => {
              setSelectedRepositoryId(event.target.value)
              setSelectedBranch('')
              setSelectedPath('')
            }}
          >
            {linkedRepositories.map((item) => (
              <option key={item.id} value={item.id}>
                {item.namespace}/{item.name}
              </option>
            ))}
          </select>
        ) : (
          <span className="small">
            {repository.namespace}/{repository.name}
          </span>
        )}
        <span className="spacer" />
        <a className="btn" href={repository.webUrl} target="_blank" rel="noreferrer">
          <PrototypeIcon name="external" />
          在远端打开
        </a>
      </div>
      <div className="section-heading">
        <h2>代码</h2>
        <span className="badge">只读</span>
        <span className="spacer" />
        <span className="small quiet">
          {providerLabel} · {tree.data?.data.branch ?? branch}
        </span>
      </div>
      {tree.isError ? (
        <PageError
          title="代码文件读取失败"
          description={describeRequestError(tree.error).description}
          requestId={describeRequestError(tree.error).requestId}
          onRetry={() => void tree.refetch()}
        />
      ) : (
        <div className="file-browser">
          <nav className="file-tree" aria-label="文件目录">
            {tree.isPending ? (
              <p className="section-note">正在读取文件树…</p>
            ) : files.length === 0 ? (
              <p className="section-note">仓库没有可展示的文件。</p>
            ) : (
              files.map((path) => (
                <button
                  key={path}
                  type="button"
                  className={`file ${activePath === path ? 'active' : ''}`}
                  onClick={() => setSelectedPath(path)}
                >
                  <PrototypeIcon name="file" />
                  {path}
                </button>
              ))
            )}
          </nav>
          <section style={{ minWidth: 0 }}>
            <div className="file-head">
              <span>{activePath || '选择文件'}</span>
              <span className="row">
                <button type="button" className="text-btn" disabled={!file.data} onClick={() => void copyContent()}>
                  复制内容
                </button>
                <button type="button" className="text-btn" disabled={!file.data} onClick={downloadContent}>
                  下载文件
                </button>
              </span>
            </div>
            {file.isPending ? (
              <p className="section-note" style={{ padding: 20 }}>
                正在读取文件…
              </p>
            ) : file.isError ? (
              <p className="section-note" style={{ padding: 20 }}>
                {describeRequestError(file.error).description}
              </p>
            ) : file.data ? (
              <>
                <pre className="code">
                  <code>{file.data.data.content}</code>
                </pre>
                {file.data.data.truncated && <p className="section-note">文件较大，仅展示前 200000 个字符。</p>}
              </>
            ) : (
              <p className="section-note" style={{ padding: 20 }}>
                选择左侧文件查看内容。
              </p>
            )}
          </section>
        </div>
      )}
      <details className="connection-form code-settings-details">
        <summary>管理仓库关联与 Git 连接</summary>
        <RepositoryPicker projectId={projectId} teamId={project.data.data.teamId} canManage={canManage} />
      </details>
    </div>
  )
}

export default Component
