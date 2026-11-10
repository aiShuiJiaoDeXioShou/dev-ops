import { useEffect, useState } from 'react'
import { useParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { PrototypeIcon } from '@/prototype/icons/icon'
import { projectQueryOptions } from '@/features/projects/public'
import {
  projectRepositoriesQueryOptions,
  repositoryBranchesQueryOptions,
  repositoryFileQueryOptions,
  repositoryTreeQueryOptions,
} from '@/features/code/public'
import { describeRequestError } from '@/shared/api/errors'
import { PageError } from '@/shared/ui/page-state'
import { PageSkeleton } from '@/shared/ui/page-skeleton'
import { useToast } from '@/shared/ui/toast'

interface FileTreeNode {
  name: string
  path: string
  type: 'file' | 'directory'
  children: FileTreeNode[]
}

/**
 * 将远端扁平文件树转换为可折叠的目录树。
 * @param entries 远端文件树条目。
 * @returns 目录优先、文件随后的树结构。
 */
function buildFileTree(entries: Array<{ path: string; type: 'file' | 'directory' }>): FileTreeNode[] {
  const root: FileTreeNode[] = []
  const sorted = [...entries].sort((left, right) => left.path.localeCompare(right.path))
  for (const entry of sorted) {
    const parts = entry.path.split('/').filter(Boolean)
    let level = root
    let currentPath = ''
    parts.forEach((part, index) => {
      currentPath = currentPath ? `${currentPath}/${part}` : part
      const isLast = index === parts.length - 1
      let node = level.find((item) => item.name === part && item.path === currentPath)
      if (!node) {
        node = {
          name: part,
          path: currentPath,
          type: isLast ? entry.type : 'directory',
          children: [],
        }
        level.push(node)
      } else if (isLast) {
        node.type = entry.type
      }
      level = node.children
    })
  }
  const sortNodes = (nodes: FileTreeNode[]): FileTreeNode[] => {
    nodes.sort((left, right) => {
      if (left.type !== right.type) return left.type === 'directory' ? -1 : 1
      return left.name.localeCompare(right.name)
    })
    for (const node of nodes) sortNodes(node.children)
    return nodes
  }
  return sortNodes(root)
}

/**
 * 渲染可折叠的代码目录树。
 * @param props.nodes 树节点；depth 层级；activePath 当前文件；expanded 展开目录；onToggle/onSelect 回调。
 * @returns 文件与目录行。
 */
function FileTree({
  nodes,
  depth = 0,
  activePath,
  expanded,
  onToggle,
  onSelect,
}: {
  nodes: FileTreeNode[]
  depth?: number
  activePath: string
  expanded: Set<string>
  onToggle: (path: string) => void
  onSelect: (path: string) => void
}) {
  return (
    <>
      {nodes.map((node) => {
        const isDirectory = node.type === 'directory'
        const isExpanded = expanded.has(node.path)
        return (
          <div key={node.path}>
            <button
              type="button"
              className={`file ${!isDirectory && activePath === node.path ? 'active' : ''} ${isDirectory ? (isExpanded ? 'directory expanded' : 'directory') : ''}`}
              style={{ paddingLeft: 10 + depth * 14 }}
              onClick={() => (isDirectory ? onToggle(node.path) : onSelect(node.path))}
            >
              {isDirectory ? (
                <>
                  <span className="tree-caret" />
                  <PrototypeIcon name="folder" />
                </>
              ) : (
                <PrototypeIcon name="file" />
              )}
              {node.name}
            </button>
            {isDirectory && isExpanded && node.children.length > 0 && (
              <FileTree
                nodes={node.children}
                depth={depth + 1}
                activePath={activePath}
                expanded={expanded}
                onToggle={onToggle}
                onSelect={onSelect}
              />
            )}
          </div>
        )
      })}
    </>
  )
}

/**
 * 项目代码页：按原型的 Git 信息条和文件浏览器展示远端仓库内容。
 * @returns 代码阅读界面；未关联仓库时显示仓库管理。
 */
export function Component() {
  const { projectId = '' } = useParams()
  const { showToast } = useToast()
  const project = useQuery(projectQueryOptions(projectId))
  const repositories = useQuery(projectRepositoriesQueryOptions(projectId))
  const [selectedRepositoryId, setSelectedRepositoryId] = useState('')
  const [selectedBranch, setSelectedBranch] = useState('')
  const [selectedPath, setSelectedPath] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const linkedRepositories = repositories.data?.data ?? []
  const repository = linkedRepositories.find((item) => item.id === selectedRepositoryId) ?? linkedRepositories[0]
  const branches = useQuery(repositoryBranchesQueryOptions(projectId, repository?.id ?? ''))
  const branchOptions = branches.data?.data.branches ?? (repository?.defaultBranch ? [repository.defaultBranch] : [])
  const branch = selectedBranch || repository?.defaultBranch || branchOptions[0] || undefined
  const tree = useQuery(repositoryTreeQueryOptions(projectId, repository?.id ?? '', branch))
  const entries = tree.data?.data.entries ?? []
  const treeNodes = buildFileTree(entries)
  const files = entries.filter((entry) => entry.type === 'file').map((entry) => entry.path)
  const defaultPath = files.find((path) => path.toLowerCase() === 'readme.md') ?? files[0] ?? ''
  const activePath = files.includes(selectedPath) ? selectedPath : defaultPath
  const file = useQuery(repositoryFileQueryOptions(projectId, repository?.id ?? '', tree.data?.data.branch, activePath))
  useEffect(() => {
    if (!activePath) return
    const parents = activePath.split('/').slice(0, -1)
    setExpanded((previous) => {
      const next = new Set(previous)
      let current = ''
      for (const parent of parents) {
        current = current ? `${current}/${parent}` : parent
        next.add(current)
      }
      return next
    })
  }, [activePath])
  if (project.isPending || repositories.isPending) return <PageSkeleton />
  if (project.isError || !project.data) {
    const described = describeRequestError(project.error)
    return (
      <PageError
        title="项目加载失败"
        description={described.description}
        requestId={described.requestId}
        onRetry={() => void project.refetch()}
      />
    )
  }
  if (!repository) {
    return <p className="section-note">尚未关联仓库，请在项目设置中关联 Git 仓库。</p>
  }
  const providerLabel =
    repository.providerKey === 'github'
      ? 'GitHub'
      : repository.providerKey === 'gitea'
        ? 'Gitea'
        : repository.providerKey
  const toggleDirectory = (path: string) => {
    setExpanded((previous) => {
      const next = new Set(previous)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }
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
    <div className="code-page">
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
            ) : treeNodes.length === 0 ? (
              <p className="section-note">仓库没有可展示的文件。</p>
            ) : (
              <FileTree
                nodes={treeNodes}
                activePath={activePath}
                expanded={expanded}
                onToggle={toggleDirectory}
                onSelect={setSelectedPath}
              />
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
              <p className="section-note" style={{ padding: 16 }}>
                正在读取文件…
              </p>
            ) : file.isError ? (
              <p className="section-note" style={{ padding: 16 }}>
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
              <p className="section-note" style={{ padding: 16 }}>
                选择左侧文件查看内容。
              </p>
            )}
          </section>
        </div>
      )}
    </div>
  )
}

export default Component
