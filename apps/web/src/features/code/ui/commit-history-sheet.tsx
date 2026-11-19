import { useId, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, GitCommitHorizontal, X } from 'lucide-react'
import { formatDateTime } from '@/shared/lib/format'
import { DelayedLoading } from '@/shared/ui/delayed-loading'
import { Button } from '@/shared/ui/controls/button'
import { Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/shared/ui/controls/sheet'
import { PageLoading, PageError } from '@/shared/ui/page-state'
import { commitQueryOptions, commitsQueryOptions } from '../api/commit-queries'
import './commit-history-sheet.css'

/**
 * 显示分支的只读提交时间线，展开单条记录时按需加载变更文件。
 * @param props.projectId 项目标识。
 * @param props.repositoryId 仓库标识。
 * @param props.ref 要读取的分支。
 * @returns 代码页的提交记录入口和右侧抽屉。
 */
export function CommitHistorySheet({
  projectId,
  repositoryId,
  ref,
}: {
  projectId: string
  repositoryId: string
  ref: string
}) {
  const [open, setOpen] = useState(false)
  const [selectedSha, setSelectedSha] = useState('')
  const detailId = useId()
  const list = useQuery({
    ...commitsQueryOptions(projectId, repositoryId, { ref, page: 1, pageSize: 30 }),
    enabled: open,
  })
  const items = list.data?.data.items ?? []
  const groups = new Map<string, { commit: (typeof items)[number]; time: string }[]>()
  for (const commit of items) {
    const [date = '—', time = '—'] = formatDateTime(commit.committedAt).split(' ')
    const entry = { commit, time }
    const group = groups.get(date)
    if (group) group.push(entry)
    else groups.set(date, [entry])
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (!nextOpen) setSelectedSha('')
      }}
    >
      <SheetTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          提交记录
        </Button>
      </SheetTrigger>
      <SheetContent
        className="commit-history-sheet gap-0 bg-background text-foreground"
        aria-describedby={undefined}
        showCloseButton={false}
      >
        <SheetHeader className="flex-row items-center justify-between border-b py-3 md:px-6">
          <SheetTitle>提交记录</SheetTitle>
          <SheetClose asChild>
            <Button type="button" variant="ghost" className="size-11 sm:size-8" aria-label="关闭提交记录">
              <X aria-hidden="true" />
            </Button>
          </SheetClose>
        </SheetHeader>
        <div className="commit-history-body">
          {list.isPending ? (
            <DelayedLoading pending>
              <PageLoading />
            </DelayedLoading>
          ) : list.isError && !list.data ? (
            <PageError
              title="提交记录加载失败"
              error={list.error}
              retrying={list.isFetching}
              onRetry={() => void list.refetch()}
            />
          ) : groups.size === 0 ? (
            <p className="text-muted-foreground">该分支没有提交记录。</p>
          ) : (
            <div className="commit-timeline">
              {Array.from(groups, ([date, commits]) => (
                <section key={date} className="commit-timeline-group">
                  <h3 className="commit-timeline-date">
                    <GitCommitHorizontal size={16} aria-hidden="true" />
                    {date}
                  </h3>
                  <ul className="commit-timeline-list">
                    {commits.map(({ commit, time }) => {
                      const isExpanded = selectedSha === commit.sha
                      return (
                        <li key={commit.sha}>
                          <Button
                            type="button"
                            unstyled
                            className="commit-timeline-entry"
                            aria-expanded={isExpanded}
                            aria-controls={isExpanded ? detailId : undefined}
                            onClick={() => setSelectedSha(isExpanded ? '' : commit.sha)}
                          >
                            <span className="commit-timeline-summary">
                              <span className="commit-timeline-title">{commit.title}</span>
                              <span className="commit-timeline-meta">
                                <span>{commit.authorName}</span>
                                <time dateTime={commit.committedAt}>{time}</time>
                                <span>核对于 {formatDateTime(commit.lastCheckedAt)}</span>
                              </span>
                            </span>
                            <code className="commit-timeline-sha">{commit.sha.slice(0, 8)}</code>
                            <ChevronDown size={14} aria-hidden="true" />
                          </Button>
                          {isExpanded ? (
                            <CommitFiles
                              id={detailId}
                              projectId={projectId}
                              repositoryId={repositoryId}
                              sha={commit.sha}
                            />
                          ) : null}
                        </li>
                      )
                    })}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

function CommitFiles({
  id,
  projectId,
  repositoryId,
  sha,
}: {
  id: string
  projectId: string
  repositoryId: string
  sha: string
}) {
  const detail = useQuery(commitQueryOptions(projectId, repositoryId, sha))
  if (detail.isPending) {
    return (
      <div id={id} className="commit-timeline-files">
        <DelayedLoading pending>
          <PageLoading />
        </DelayedLoading>
      </div>
    )
  }
  if (detail.isError && !detail.data) {
    return (
      <div id={id} className="commit-timeline-files">
        <PageError
          title="提交详情加载失败"
          error={detail.error}
          retrying={detail.isFetching}
          onRetry={() => void detail.refetch()}
        />
      </div>
    )
  }
  const { files, filesUnsupported, filesTruncated } = detail.data.data
  return (
    <section id={id} className="commit-timeline-files" aria-label="提交详情">
      <h4>变更文件</h4>
      {filesUnsupported ? (
        <p>来源不支持查看变更文件。</p>
      ) : files.length === 0 ? (
        <p>该提交没有变更文件。</p>
      ) : (
        <ul>
          {files.map((file) => (
            <li key={file.path}>
              <span>{file.path}</span>
              <span className="text-muted-foreground">
                +{file.additions} / -{file.deletions}
              </span>
            </li>
          ))}
        </ul>
      )}
      {filesTruncated ? <p>变更文件已截断。</p> : null}
    </section>
  )
}
