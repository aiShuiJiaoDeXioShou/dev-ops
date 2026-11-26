import { useEffect, useState } from 'react'
import { useParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import {
  Check,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FileDiff,
  FileText,
  Folder,
  FolderGit2,
  GitBranch,
  History,
} from 'lucide-react'
import { projectQueryOptions } from '@/features/projects/api/queries'
import { CodeChangeSection } from '@/features/tools/ui/code-change-section'
import { CodeInvocationLogSheet } from '@/features/tools/ui/code-invocation-log'
import { CommitHistorySheet } from '@/features/code/ui/commit-history-sheet'
import { GitHubWriteAction } from '@/features/code/ui/github-write-action'
import { pickDefaultPreviewPath } from '@/features/code/lib/default-preview'
import {
  projectRepositoriesQueryOptions,
  repositoryBranchesQueryOptions,
  repositoryFileQueryOptions,
  repositoryTreeQueryOptions,
} from '@/features/code/api/queries'
import { describeRequestError } from '@/shared/api/errors'
import { PageError } from '@/shared/ui/page-state'
import { CodePageSkeleton } from '@/pages/page-skeletons'
import { LogLinesSkeleton } from '@/shared/ui/page-skeleton'
import { Skeleton, SkeletonRegion } from '@/shared/ui/controls/skeleton'
import { Button } from '@/shared/ui/controls/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/shared/ui/controls/sheet'
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
import { repositoryMarkdownUrl } from '@/features/code/lib/markdown-url'
import { highlightCode } from '@/shared/lib/highlight'
import 'highlight.js/styles/github.css'

type FileTreeEntry = { path: string; type: 'file' | 'directory' }

interface FileTreeScope {
  projectId: string
  repositoryId: string
  branch?: string
  activePath: string
  expanded: Set<string>
  onToggle: (path: string) => void
  onSelect: (path: string) => void
}

function DirectoryChildren({ scope, path, depth }: { scope: FileTreeScope; path: string; depth: number }) {
  const directory = useQuery(repositoryTreeQueryOptions(scope.projectId, scope.repositoryId, scope.branch, path))
  if (directory.isPending) {
    return (
      <SkeletonRegion label="目录加载中" delay={0} className="ml-5 space-y-2 py-1">
        <Skeleton width="68%" height={12} />
        <Skeleton width="52%" height={12} />
      </SkeletonRegion>
    )
  }
  if (directory.isError) {
    return (
      <div className="ml-5">
        <p className="section-note" role="alert">
          {describeRequestError(directory.error).description}
        </p>
        <Button variant="ghost" size="sm" onClick={() => void directory.refetch()} disabled={directory.isFetching}>
          重试读取目录
        </Button>
      </div>
    )
  }
  if (directory.data.data.entries.length === 0) return <p className="section-note ml-5">空目录</p>
  return <FileTree entries={directory.data.data.entries} depth={depth} scope={scope} />
}

function FileTree({ entries, scope, depth = 0 }: { entries: FileTreeEntry[]; scope: FileTreeScope; depth?: number }) {
  const { activePath, expanded, onToggle, onSelect } = scope
  const sorted = [...entries].sort((left, right) =>
    left.type === right.type ? left.path.localeCompare(right.path) : left.type === 'directory' ? -1 : 1,
  )
  return (
    <>
      {sorted.map((entry) => {
        const isDirectory = entry.type === 'directory'
        const isExpanded = expanded.has(entry.path)
        return (
          <div key={entry.path}>
            <button
              type="button"
              className={`file ${!isDirectory && activePath === entry.path ? 'active' : ''} ${isDirectory ? 'directory' : ''}`}
              aria-expanded={isDirectory ? isExpanded : undefined}
              style={{ paddingLeft: 10 + depth * 14 }}
              onClick={() => (isDirectory ? onToggle(entry.path) : onSelect(entry.path))}
            >
              {isDirectory ? (
                <>
                  {isExpanded ? (
                    <ChevronDown className="tree-caret size-3.5" aria-hidden="true" />
                  ) : (
                    <ChevronRight className="tree-caret size-3.5" aria-hidden="true" />
                  )}
                  <Folder className="size-4" aria-hidden="true" />
                </>
              ) : (
                <FileText className="size-4" aria-hidden="true" />
              )}
              {entry.path.split('/').at(-1)}
            </button>
            {isDirectory && isExpanded && <DirectoryChildren scope={scope} path={entry.path} depth={depth + 1} />}
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
  return <ProjectCodePage key={projectId} projectId={projectId} />
}

function ProjectCodePage({ projectId }: { projectId: string }) {
  const { showToast } = useToast()
  const project = useQuery(projectQueryOptions(projectId))
  const repositories = useQuery(projectRepositoriesQueryOptions(projectId))
  const [selectedRepositoryId, setSelectedRepositoryId] = useState('')
  const [selectedBranch, setSelectedBranch] = useState('')
  const [selectedPath, setSelectedPath] = useState('')
  const [changesOpen, setChangesOpen] = useState(false)
  const [invocationsOpen, setInvocationsOpen] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [viewMode, setViewMode] = useState<'preview' | 'code'>('preview')
  const linkedRepositories = repositories.data?.data ?? []
  const repository = linkedRepositories.find((item) => item.id === selectedRepositoryId) ?? linkedRepositories[0]
  const branches = useQuery(repositoryBranchesQueryOptions(projectId, repository?.id ?? ''))
  const branchOptions = branches.data?.data.branches ?? (repository?.defaultBranch ? [repository.defaultBranch] : [])
  const branch = selectedBranch || repository?.defaultBranch || branchOptions[0] || undefined
  const tree = useQuery(repositoryTreeQueryOptions(projectId, repository?.id ?? '', branch))
  const entries = tree.data?.data.entries ?? []
  const files = entries.filter((entry) => entry.type === 'file').map((entry) => entry.path)
  const defaultPath = pickDefaultPreviewPath(files)
  const activePath = selectedPath || defaultPath
  const file = useQuery(repositoryFileQueryOptions(projectId, repository?.id ?? '', tree.data?.data.branch, activePath))
  useEffect(() => {
    setViewMode('preview')
  }, [activePath])
  if (project.isPending || repositories.isPending) return <CodePageSkeleton />
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
              <GitBranch className="size-4" aria-hidden="true" />
              <span>{currentBranch || '默认分支'}</span>
              <ChevronDown className="size-3.5" aria-hidden="true" />
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
                  setExpanded(new Set())
                }}
              >
                {item === currentBranch ? (
                  <Check className="size-4" aria-hidden="true" />
                ) : (
                  <GitBranch className="size-4" aria-hidden="true" />
                )}
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
        <FolderGit2 className="size-4" aria-hidden="true" />
        {linkedRepositories.length > 1 ? (
          <select
            aria-label="选择仓库"
            value={repository.id}
            onChange={(event) => {
              setSelectedRepositoryId(event.target.value)
              setSelectedBranch('')
              setSelectedPath('')
              setExpanded(new Set())
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
        <Button type="button" variant="outline" size="sm" onClick={() => setChangesOpen(true)}>
          <FileDiff className="size-4" aria-hidden="true" />
          代码变更
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="查看写能力调用记录"
          title="写能力调用记录"
          onClick={() => setInvocationsOpen(true)}
        >
          <History className="size-4" aria-hidden="true" />
        </Button>
        <CommitHistorySheet
          key={JSON.stringify([repository.id, currentBranch])}
          projectId={projectId}
          repositoryId={repository.id}
          ref={currentBranch}
        />
        <a className="btn" href={repository.webUrl} target="_blank" rel="noreferrer">
          <ExternalLink className="size-4" aria-hidden="true" />在 {providerLabel} 打开
        </a>
      </div>
      {tree.isError ? (
        <PageError
          title="代码文件读取失败"
          error={tree.error}
          description={describeRequestError(tree.error).description}
          requestId={describeRequestError(tree.error).requestId}
          onRetry={() => void tree.refetch()}
        />
      ) : (
        <div className="file-browser">
          <nav className="file-tree" aria-label="文件目录">
            {tree.isPending ? (
              <div className="file-tree-skeleton" role="status" aria-busy="true" aria-label="文件树加载中">
                {['68%', '52%', '76%', '44%', '62%', '58%', '48%', '70%'].map((width, index) => (
                  <Skeleton key={index} width={width} height={12} />
                ))}
              </div>
            ) : entries.length === 0 ? (
              <p className="section-note">仓库没有可展示的文件。</p>
            ) : (
              <FileTree
                entries={entries}
                scope={{
                  projectId,
                  repositoryId: repository.id,
                  branch: tree.data?.data.branch,
                  activePath,
                  expanded,
                  onToggle: toggleDirectory,
                  onSelect: setSelectedPath,
                }}
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
                <GitHubWriteAction
                  projectId={projectId}
                  intent={
                    repository.providerKey === 'github' && file.isSuccess && currentBranch && activePath
                      ? {
                          repositoryId: repository.id,
                          label: `${repository.namespace}/${repository.name}`,
                          action: { action: 'edit_file', branch: currentBranch, path: activePath },
                        }
                      : null
                  }
                />
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
            {file.isPending && activePath ? (
              <div className="p-4">
                <LogLinesSkeleton lines={12} label="文件加载中" />
              </div>
            ) : file.isError && !file.data ? (
              <PageError
                title="文件读取失败"
                error={file.error}
                retrying={file.isFetching}
                onRetry={() => void file.refetch()}
              />
            ) : file.data ? (
              <>
                {/\.(md|mdx)$/i.test(activePath) && viewMode === 'preview' ? (
                  <div className="code-markdown-preview">
                    <Markdown
                      resolveUrl={(url, kind) =>
                        repositoryMarkdownUrl(url, kind, {
                          providerKey: repository.providerKey,
                          webUrl: repository.webUrl,
                          branch: currentBranch ?? repository.defaultBranch,
                          path: activePath,
                        })
                      }
                    >
                      {file.data.data.content}
                    </Markdown>
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
      <Sheet open={changesOpen} onOpenChange={setChangesOpen}>
        <SheetContent className="code-changes-sheet">
          <SheetHeader>
            <SheetTitle>代码变更</SheetTitle>
            <SheetDescription>受控修改、校验与 PR；记录不再铺在代码浏览器下方。</SheetDescription>
          </SheetHeader>
          <div className="code-changes-sheet-body">
            <CodeChangeSection projectId={projectId} repositoryId={repository.id} embedded />
          </div>
        </SheetContent>
      </Sheet>
      <CodeInvocationLogSheet projectId={projectId} open={invocationsOpen} onOpenChange={setInvocationsOpen} />
    </div>
  )
}

export default Component
