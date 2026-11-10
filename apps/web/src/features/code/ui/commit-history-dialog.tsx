import { useState, type FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { describeRequestError } from '@/shared/api/errors'
import { Button } from '@/shared/ui/controls/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/controls/dialog'
import { PageLoading } from '@/shared/ui/page-state'
import { commitQueryOptions, commitsQueryOptions } from '../api/commit-queries'

/** 代码页提交记录：列表与详情只读，含最近核对时间与变更文件。 */
export function CommitHistoryDialog({
  projectId,
  repositoryId,
  ref,
  open,
  onOpenChange,
}: {
  projectId: string
  repositoryId: string
  ref: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [selectedRef, setSelectedRef] = useState('')
  const list = useQuery({ ...commitsQueryOptions(projectId, repositoryId, { ref, page: 1, pageSize: 30 }), enabled: open })
  const detail = useQuery({ ...commitQueryOptions(projectId, repositoryId, selectedRef), enabled: open && Boolean(selectedRef) })
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form className="space-y-4" onSubmit={(event: FormEvent) => event.preventDefault()}>
          <DialogHeader>
            <DialogTitle>提交记录</DialogTitle>
          </DialogHeader>
          {list.isPending ? (
            <PageLoading />
          ) : list.isError ? (
            <p role="alert">提交记录加载失败：{describeRequestError(list.error).description}</p>
          ) : list.data.data.items.length === 0 ? (
            <p className="muted">该分支没有提交记录。</p>
          ) : (
            <ul className="plain-list">
              {list.data.data.items.map((commit) => (
                <li key={commit.sha}>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedRef(commit.sha)}
                  >
                    {commit.sha.slice(0, 8)} {commit.title}
                  </Button>
                  <span className="muted">{commit.authorName}</span>
                  <span className="muted">{commit.committedAt}</span>
                  <span className="muted">核对：{commit.lastCheckedAt}</span>
                </li>
              ))}
            </ul>
          )}
          {selectedRef ? (
            <section aria-label="提交详情">
              {detail.isPending ? (
                <PageLoading />
              ) : detail.isError ? (
                <p className="muted">提交详情加载失败。</p>
              ) : (
                <>
                  <h4>{detail.data.data.title}</h4>
                  <p className="muted">
                    {detail.data.data.authorName} · {detail.data.data.committedAt}
                  </p>
                  {detail.data.data.filesUnsupported ? (
                    <p className="muted">来源不支持变更文件。</p>
                  ) : detail.data.data.files.length === 0 ? (
                    <p className="muted">该提交没有变更文件。</p>
                  ) : (
                    <ul className="plain-list">
                      {detail.data.data.files.map((file) => (
                        <li key={file.path}>
                          <span>{file.path}</span>
                          <span className="muted">
                            +{file.additions} / -{file.deletions}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {detail.data.data.filesTruncated ? <p className="muted">变更文件已截断。</p> : null}
                </>
              )}
            </section>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              关闭
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
