import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useParams } from 'react-router'
import { GitMerge, GitPullRequest, GitPullRequestClosed, X } from 'lucide-react'
import {
  listProjectRepositoriesQueryOptions,
  pullRequestDiffQueryOptions,
  pullRequestQueryOptions,
  pullRequestsAllQueryOptions,
} from '@/features/code/public'
import { describeRequestError } from '@/shared/api/errors'
import { formatDateTime } from '@/shared/lib/format'
import { cn } from '@/shared/lib/utils'
import { isNestedInteractiveTarget } from '@/shared/lib/clickable'
import { DelayedLoading } from '@/shared/ui/delayed-loading'
import { Button } from '@/shared/ui/controls/button'
import { Input } from '@/shared/ui/controls/input'
import { Select } from '@/shared/ui/controls/select'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/shared/ui/controls/sheet'
import { EmptyState, PageError, PageLoading } from '@/shared/ui/page-state'
import { DelayedPageSkeleton } from '@/shared/ui/page-skeleton'
import { Tag } from '@/shared/ui/tag'

const STATE_LABELS: Record<string, string> = {
  open: '打开',
  closed: '已关闭',
  merged: '已合并',
  unknown: '未知',
}
const REVIEW_LABELS: Record<string, string> = {
  pending: '待评审',
  approved: '已通过',
  changes_requested: '需修改',
  unknown: '未知',
}
const REVIEW_VARIANTS = {
  pending: 'neutral',
  approved: 'green',
  changes_requested: 'red',
  unknown: 'neutral',
} as const
const PROVIDER_LABELS = { github: 'GitHub', gitea: 'Gitea' } as const

interface ChangedFile {
  path: string
  status: string
  additions: number
  deletions: number
  patch: string | null
  binary: boolean
  truncated: boolean
}

/**
 * 按目录分组变更文件，作为抽屉里的文件树。
 * @param files PR 变更文件。
 * @returns 按目录排序的分组，组内保持文件顺序。
 */
function groupChangedFiles(files: ChangedFile[]) {
  const groups = new Map<string, ChangedFile[]>()
  for (const file of files) {
    const separator = file.path.lastIndexOf('/')
    const directory = separator === -1 ? '' : file.path.slice(0, separator)
    const group = groups.get(directory)
    if (group) group.push(file)
    else groups.set(directory, [file])
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([directory, groupFiles]) => ({ directory, files: groupFiles }))
}

/** 判断差异行类型；用于对新增、删除和 hunk 行着色。 */
function diffLineClass(line: string): string {
  if (line.startsWith('@@')) return 'diff-line hunk'
  if (line.startsWith('+') && !line.startsWith('+++')) return 'diff-line add'
  if (line.startsWith('-') && !line.startsWith('---')) return 'diff-line remove'
  return 'diff-line'
}

/**
 * 按 PR 状态渲染 GitHub 风格的状态图标。
 * @param state 远端 PR 状态。
 * @returns 打开、合并、关闭或未知状态图标。
 */
function PullRequestStateIcon({ state }: { state: string }) {
  if (state === 'merged') return <GitMerge className="pr-icon merged" aria-label="已合并" />
  if (state === 'closed') return <GitPullRequestClosed className="pr-icon closed" aria-label="已关闭" />
  return (
    <GitPullRequest className={`pr-icon ${state === 'open' ? 'open' : ''}`} aria-label={STATE_LABELS[state] ?? 'PR'} />
  )
}

/** 项目 PR 页：GitHub 风格列表，点击 PR 从右侧抽屉查看文件树、差异与摘要。 */
export function Component() {
  const { projectId = '' } = useParams()
  const [repositoryId, setRepositoryId] = useState('')
  const [state, setState] = useState<'all' | 'open' | 'closed'>('all')
  const [search, setSearch] = useState('')
  const [author, setAuthor] = useState('')
  const [reviewStatus, setReviewStatus] = useState('')
  const [selectedNumber, setSelectedNumber] = useState('')
  const [selectedFile, setSelectedFile] = useState('')
  const [showFullDiff, setShowFullDiff] = useState(false)
  const repositories = useQuery(listProjectRepositoriesQueryOptions(projectId))
  const currentRepositoryId = repositoryId || repositories.data?.data[0]?.id || ''
  const repository = repositories.data?.data.find((item) => item.id === currentRepositoryId)
  const list = useQuery(pullRequestsAllQueryOptions(projectId, currentRepositoryId))
  const detail = useQuery(pullRequestQueryOptions(projectId, currentRepositoryId, selectedNumber))
  const diff = useQuery(pullRequestDiffQueryOptions(projectId, currentRepositoryId, selectedNumber))
  const allPullRequests = list.data ?? []
  const openCount = allPullRequests.filter((item) => item.state === 'open').length
  const closedCount = allPullRequests.filter((item) => item.state === 'closed' || item.state === 'merged').length
  const authors = useMemo(
    () =>
      [...new Set(allPullRequests.map((item) => item.authorName).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [allPullRequests],
  )
  const keyword = search.trim().toLowerCase()
  const filteredPullRequests = allPullRequests.filter((item) => {
    const matchesState =
      state === 'all' ||
      (state === 'open' && item.state === 'open') ||
      (state === 'closed' && (item.state === 'closed' || item.state === 'merged'))
    const matchesAuthor = !author || item.authorName === author
    const matchesReview = !reviewStatus || item.reviewStatus === reviewStatus
    const matchesSearch =
      !keyword ||
      `${item.number} ${item.title} ${item.authorName} ${item.sourceBranch} ${item.targetBranch}`
        .toLowerCase()
        .includes(keyword)
    return matchesState && matchesAuthor && matchesReview && matchesSearch
  })
  const hasFilters = Boolean(keyword || author || reviewStatus || state !== 'all')
  const clearFilters = () => {
    setState('all')
    setSearch('')
    setAuthor('')
    setReviewStatus('')
  }
  const closeDrawer = () => {
    setSelectedNumber('')
    setSelectedFile('')
    setShowFullDiff(false)
  }
  const changedFiles: ChangedFile[] = detail.data?.data.files ?? []
  const activeFile = changedFiles.find((file) => file.path === selectedFile) ?? changedFiles[0]
  const fileGroups = groupChangedFiles(changedFiles)

  if (repositories.isPending) return <DelayedPageSkeleton />
  if (repositories.isError) {
    return (
      <PageError
        title="仓库加载失败"
        description={describeRequestError(repositories.error).description}
        requestId={describeRequestError(repositories.error).requestId}
        retrying={repositories.isFetching}
        onRetry={() => void repositories.refetch()}
      />
    )
  }
  if (repositories.data.data.length === 0) {
    return <EmptyState mascot="aperture" title="尚未关联仓库" description="请先在项目设置中关联代码仓库。" />
  }
  const providerLabel = repository
    ? (PROVIDER_LABELS[repository.providerKey as keyof typeof PROVIDER_LABELS] ?? repository.providerKey)
    : '代码平台'
  return (
    <div className="project-tab-panel prs-page">
      <div className="prs-toolbar">
        <div className="prs-search">
          <Input
            value={search}
            maxLength={200}
            placeholder="搜索 PR 标题、编号或作者"
            aria-label="搜索 PR"
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        {repositories.data.data.length > 1 && (
          <Select
            className="project-filter"
            aria-label="仓库"
            value={currentRepositoryId}
            onChange={(event) => {
              setRepositoryId(event.target.value)
              closeDrawer()
              clearFilters()
            }}
          >
            {repositories.data.data.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </Select>
        )}
        {repository && (
          <a className="btn" href={`${repository.webUrl}/pulls`} target="_blank" rel="noreferrer">
            在 {providerLabel} 打开
          </a>
        )}
      </div>
      <div className="prs-filters">
        <div className="pr-state-tabs" role="group" aria-label="PR 状态筛选">
          {[
            { value: 'all' as const, label: '全部', count: allPullRequests.length },
            { value: 'open' as const, label: '打开', count: openCount },
            { value: 'closed' as const, label: '已关闭', count: closedCount },
          ].map((item) => (
            <Button
              key={item.value}
              type="button"
              size="sm"
              variant={state === item.value ? 'secondary' : 'ghost'}
              aria-pressed={state === item.value}
              onClick={() => setState(item.value)}
            >
              {item.label}
              <span className="counter">{item.count}</span>
            </Button>
          ))}
        </div>
        <Select aria-label="作者筛选" value={author} onChange={(event) => setAuthor(event.target.value)}>
          <option value="">全部作者</option>
          {authors.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </Select>
        <Select
          aria-label="评审状态筛选"
          value={reviewStatus}
          onChange={(event) => setReviewStatus(event.target.value)}
        >
          <option value="">全部评审状态</option>
          {Object.entries(REVIEW_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
        {hasFilters && (
          <Button type="button" variant="ghost" size="sm" onClick={clearFilters}>
            清除筛选
          </Button>
        )}
      </div>
      {list.isPending ? (
        <DelayedLoading pending>
          <PageLoading />
        </DelayedLoading>
      ) : list.isError ? (
        <PageError
          title="PR 加载失败"
          description={describeRequestError(list.error).description}
          requestId={describeRequestError(list.error).requestId}
          retrying={list.isFetching}
          onRetry={() => void list.refetch()}
        />
      ) : allPullRequests.length === 0 ? (
        <EmptyState mascot="aperture" title="仓库还没有 Pull requests" description="在代码平台创建 PR 后刷新页面。" />
      ) : filteredPullRequests.length === 0 ? (
        <EmptyState
          mascot="aperture"
          title="没有匹配的 PR"
          description="调整状态、作者或评审状态筛选后再试。"
          action={
            <Button type="button" variant="outline" size="sm" onClick={clearFilters}>
              清除筛选
            </Button>
          }
        />
      ) : (
        <ul className="pr-list">
          {filteredPullRequests.map((pullRequest) => (
            <li
              key={pullRequest.number}
              className={`pr-row clickable-list-item ${selectedNumber === String(pullRequest.number) ? 'selected' : ''}`}
              onClick={(event) => {
                if (isNestedInteractiveTarget(event.target)) return
                setSelectedNumber(String(pullRequest.number))
                setSelectedFile('')
                setShowFullDiff(false)
              }}
            >
              <PullRequestStateIcon state={pullRequest.state} />
              <div className="pr-main">
                <Button
                  type="button"
                  variant="link"
                  className="pr-title"
                  onClick={() => {
                    setSelectedNumber(String(pullRequest.number))
                    setSelectedFile('')
                    setShowFullDiff(false)
                  }}
                >
                  {pullRequest.title}
                </Button>
                <p className="pr-meta">
                  #{pullRequest.number} · {pullRequest.authorName} · {pullRequest.sourceBranch} →{' '}
                  {pullRequest.targetBranch} · 更新于 {formatDateTime(pullRequest.updatedAt)}
                </p>
              </div>
              <div className="pr-badges">
                {pullRequest.reviewStatus !== 'unknown' && (
                  <Tag variant={REVIEW_VARIANTS[pullRequest.reviewStatus as keyof typeof REVIEW_VARIANTS] ?? 'neutral'}>
                    {REVIEW_LABELS[pullRequest.reviewStatus] ?? pullRequest.reviewStatus}
                  </Tag>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <Sheet open={Boolean(selectedNumber)} onOpenChange={(open) => (!open ? closeDrawer() : undefined)}>
        <SheetContent side="right" showCloseButton={false} className="pr-sheet-content">
          <div className="pr-sheet-head">
            <div className="pr-sheet-title">
              <SheetTitle>
                {detail.data ? `#${detail.data.data.number} ${detail.data.data.title}` : `PR #${selectedNumber}`}
              </SheetTitle>
              <SheetDescription className="pr-sheet-meta">
                {detail.data
                  ? `${detail.data.data.sourceBranch} → ${detail.data.data.targetBranch} · ${
                      STATE_LABELS[detail.data.data.state] ?? detail.data.data.state
                    } · ${detail.data.data.authorName}`
                  : '正在加载 PR 详情…'}
              </SheetDescription>
            </div>
            <div className="row">
              {detail.data?.data.url && (
                <a className="text-btn" href={detail.data.data.url} target="_blank" rel="noreferrer">
                  在 {providerLabel} 打开
                </a>
              )}
              <Button type="button" variant="ghost" size="icon-sm" aria-label="关闭 PR 详情" onClick={closeDrawer}>
                <X aria-hidden="true" />
              </Button>
            </div>
          </div>
          {detail.isPending ? (
            <div className="pr-sheet-state">
              <PageLoading message="PR 详情加载中…" />
            </div>
          ) : detail.isError ? (
            <div className="pr-sheet-state">
              <PageError
                title="PR 详情加载失败"
                description={describeRequestError(detail.error).description}
                requestId={describeRequestError(detail.error).requestId}
                retrying={detail.isFetching}
                onRetry={() => void detail.refetch()}
              />
            </div>
          ) : (
            <div className="pr-sheet-body">
              <aside className="pr-file-tree" aria-label="变更文件">
                <p className="pr-file-tree-title">变更文件（{changedFiles.length}）</p>
                {fileGroups.length === 0 ? (
                  <p className="section-note">来源未返回变更文件。</p>
                ) : (
                  fileGroups.map((group) => (
                    <div key={group.directory || '(root)'} className="pr-file-group">
                      {group.directory && <p className="pr-file-dir">{group.directory}/</p>}
                      {group.files.map((file) => (
                        <Button
                          key={file.path}
                          type="button"
                          variant="ghost"
                          size="sm"
                          className={cn('pr-file', activeFile?.path === file.path && 'active')}
                          onClick={() => {
                            setSelectedFile(file.path)
                            setShowFullDiff(false)
                          }}
                        >
                          <span className="truncate">{file.path.split('/').at(-1)}</span>
                          <span className="pr-file-stats">
                            +{file.additions} −{file.deletions}
                          </span>
                        </Button>
                      ))}
                    </div>
                  ))
                )}
              </aside>
              <section className="pr-diff-pane" aria-label="文件差异">
                {activeFile ? (
                  <>
                    <div className="pr-diff-head">
                      <div className="pr-diff-path">
                        <strong>{activeFile.path}</strong>
                        <span className="pr-file-stats">
                          +{activeFile.additions} −{activeFile.deletions}
                          {activeFile.truncated ? ' · 已截断' : ''}
                        </span>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-pressed={showFullDiff}
                        onClick={() => setShowFullDiff((current) => !current)}
                      >
                        {showFullDiff ? '收起完整差异' : '查看完整差异'}
                      </Button>
                    </div>
                    {activeFile.binary ? (
                      <p className="section-note">二进制文件，不展示文本差异。</p>
                    ) : showFullDiff ? (
                      <FullDiff
                        diff={diff}
                        ariaLabel="PR 完整差异"
                        describeError={(cause) => describeRequestError(cause).description}
                      />
                    ) : activeFile.patch ? (
                      <DiffPatch patch={activeFile.patch} ariaLabel="PR 差异" />
                    ) : (
                      <p className="section-note">来源未返回该文件的文本差异，可查看完整差异。</p>
                    )}
                  </>
                ) : (
                  <p className="section-note">选择左侧文件查看差异。</p>
                )}
              </section>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  )
}

/** 渲染单个文件的差异文本，按行标记新增、删除和 hunk。 */
function DiffPatch({ patch, ariaLabel }: { patch: string; ariaLabel: string }) {
  return (
    <pre className="code-view pr-diff" aria-label={ariaLabel}>
      {patch.split('\n').map((line, index) => (
        <span key={index} className={diffLineClass(line)}>
          {line || ' '}
          {'\n'}
        </span>
      ))}
    </pre>
  )
}

/** 渲染 PR 完整差异；加载失败时保留提示和重试入口。 */
function FullDiff({
  diff,
  ariaLabel,
  describeError,
}: {
  diff: {
    isPending: boolean
    isError: boolean
    error: unknown
    data?: { data: { patch: string; truncated: boolean } }
    refetch: () => void
    isFetching: boolean
  }
  ariaLabel: string
  describeError: (cause: unknown) => string
}) {
  if (diff.isPending) {
    return (
      <DelayedLoading pending>
        <PageLoading message="差异加载中…" />
      </DelayedLoading>
    )
  }
  if (diff.isError) {
    return (
      <PageError
        title="差异加载失败"
        description={describeError(diff.error)}
        retrying={diff.isFetching}
        onRetry={() => diff.refetch()}
      />
    )
  }
  if (!diff.data) return null
  return (
    <>
      <DiffPatch patch={diff.data.data.patch} ariaLabel={ariaLabel} />
      {diff.data.data.truncated && <p className="section-note">完整差异已截断，仅展示前 200000 个字符。</p>}
    </>
  )
}

export default Component
