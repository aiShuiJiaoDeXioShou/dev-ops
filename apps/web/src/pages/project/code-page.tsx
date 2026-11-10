import { useEffect, useState } from 'react'
import { useParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { PrototypeIcon } from '@/prototype/icons/icon'
import { projectQueryOptions } from '@/features/projects/public'
import {
  CommitHistoryDialog,
  projectRepositoriesQueryOptions,
  repositoryBranchesQueryOptions,
  repositoryFileQueryOptions,
  repositoryTreeQueryOptions,
} from '@/features/code/public'
import { describeRequestError } from '@/shared/api/errors'
import { PageError } from '@/shared/ui/page-state'
import { PageSkeleton } from '@/shared/ui/page-skeleton'
import { Button } from '@/shared/ui/controls/button'
import { useToast } from '@/shared/ui/toast'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/ui/controls/dropdown-menu'
import { Markdown } from '@/shared/lib/markdown'
import { highlightCode } from '@/shared/lib/highlight'
import 'highlight.js/styles/github.css'

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
                  <PrototypeIcon name="down" className="tree-caret" />
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
 * 根据代码平台生成文件链接。
 */
function fileUrlFor(provider: string, webUrl: string, branch: string, path: string): string {
  const base = webUrl.replace(/\/$/, '')
  const encoded = path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')
  if (provider === 'gitea') return `${base}/src/branch/${encodeURIComponent(branch)}/${encoded}`
  return `${base}/blob/${encodeURIComponent(branch)}/${encoded}`
}

/** 生成仓库 ZIP 下载链接。 */
function archiveUrlFor(provider: string, webUrl: string, branch: string): string {
  const base = webUrl.replace(/\/$/, '')
  if (provider === 'github') return `${base}/archive/refs/heads/${encodeURIComponent(branch)}.zip`
  return `${base}/archive/${encodeURIComponent(branch)}.zip`
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
  const [commitsOpen, setCommitsOpen] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [viewMode, setViewMode] = useState<'preview' | 'code'>('preview')
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
    setViewMode('preview')
  }, [activePath])
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
  const copyText = async (text: string, successMessage: string) => {
    try {
      await navigator.clipboard.writeText(text)
      showToast(successMessage, 'success')
    } catch {
      showToast('浏览器拒绝剪贴板权限，请手动复制', 'error')
    }
  }
  const currentBranch = tree.data?.data.branch ?? branch ?? ''
  const fileLink =
    currentBranch && activePath ? fileUrlFor(repository.providerKey, repository.webUrl, currentBranch, activePath) : ''
  const archiveLink = currentBranch
    ? archiveUrlFor(repository.providerKey, repository.webUrl, currentBranch)
    : repository.webUrl
  return (
    <div className="code-page">
      <div className="git-strip">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className="git-branch-button" aria-label="切换代码分支">
              <PrototypeIcon name="branch" />
              <span>{currentBranch || '默认分支'}</span>
              <PrototypeIcon name="down" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="git-branch-menu" align="start">
            <DropdownMenuLabel>切换分支</DropdownMenuLabel>
            {branchOptions.map((item) => (
              <DropdownMenuItem
                key={item}
                onSelect={() => {
                  setSelectedBranch(item)
                  setSelectedPath('')
                }}
              >
                <PrototypeIcon name={item === currentBranch ? 'check' : 'branch'} />
                {item}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => void copyText(currentBranch, '分支名已复制')}>
              复制分支名
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void copyText(repository.webUrl, '仓库链接已复制')}>
              复制仓库链接
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => window.open(archiveLink, '_blank', 'noopener,noreferrer')}>
              下载 ZIP
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
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
        <Button type="button" variant="outline" size="sm" onClick={() => setCommitsOpen(true)}>
          提交记录
        </Button>
        <a className="btn" href={repository.webUrl} target="_blank" rel="noreferrer">
          <PrototypeIcon name="external" />在 {providerLabel} 打开
        </a>
      </div>
      <CommitHistoryDialog
        projectId={projectId}
        repositoryId={repository.id}
        ref={currentBranch}
        open={commitsOpen}
        onOpenChange={setCommitsOpen}
      />
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
              <div className="file-tree-skeleton" role="status" aria-label="文件树加载中">
                {[68, 52, 76, 44, 62, 58, 48, 70].map((width, index) => (
                  <span key={index} className="skeleton-line" style={{ width: `${width}%` }} />
                ))}
              </div>
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
              <span className="row">
                <span>{activePath || '选择文件'}</span>
                {/\.(md|mdx)$/i.test(activePath) && (
                  <span className="file-tabs">
                    <button
                      type="button"
                      className={`file-tab ${viewMode === 'preview' ? 'active' : ''}`}
                      onClick={() => setViewMode('preview')}
                    >
                      预览
                    </button>
                    <button
                      type="button"
                      className={`file-tab ${viewMode === 'code' ? 'active' : ''}`}
                      onClick={() => setViewMode('code')}
                    >
                      代码
                    </button>
                  </span>
                )}
              </span>
              <span className="row">
                <button type="button" className="text-btn" disabled={!file.data} onClick={() => void copyContent()}>
                  复制内容
                </button>
                <button
                  type="button"
                  className="text-btn"
                  disabled={!fileLink}
                  onClick={() => void copyText(fileLink, '文件链接已复制')}
                >
                  复制文件链接
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
                {/\.(md|mdx)$/i.test(activePath) && viewMode === 'preview' ? (
                  <div className="code-markdown-preview">
                    <Markdown>{file.data.data.content}</Markdown>
                  </div>
                ) : (
                  <pre className="code">
                    {/* highlight.js 先转义源码再生成高亮 HTML，不直接注入远端原始 HTML。 */}
                    <code
                      className="hljs"
                      dangerouslySetInnerHTML={{ __html: highlightCode(file.data.data.content, activePath) }}
                    />
                  </pre>
                )}
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
