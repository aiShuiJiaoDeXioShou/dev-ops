import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useParams } from 'react-router'
import {
  listProjectRepositoriesQueryOptions,
  pullRequestDiffQueryOptions,
  pullRequestQueryOptions,
  pullRequestsQueryOptions,
} from '@/features/code/public'
import { describeRequestError } from '@/shared/api/errors'
import { DelayedLoading } from '@/shared/ui/delayed-loading'
import { Button } from '@/shared/ui/controls/button'
import { Select } from '@/shared/ui/controls/select'
import { EmptyState, PageLoading } from '@/shared/ui/page-state'
import { DelayedPageSkeleton } from '@/shared/ui/page-skeleton'

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

/** 项目 PR 页：按仓库查看 PR 列表、变更文件与差异，全部只读。 */
export function Component() {
  const { projectId = '' } = useParams()
  const [repositoryId, setRepositoryId] = useState('')
  const [state, setState] = useState<'open' | 'closed' | 'all' | ''>('')
  const [selectedNumber, setSelectedNumber] = useState('')
  const repositories = useQuery(listProjectRepositoriesQueryOptions(projectId))
  const currentRepositoryId = repositoryId || repositories.data?.data[0]?.id || ''
  const list = useQuery(
    pullRequestsQueryOptions(projectId, currentRepositoryId, {
      ...(state ? { state } : {}),
      page: 1,
      pageSize: 20,
    }),
  )
  const detail = useQuery(pullRequestQueryOptions(projectId, currentRepositoryId, selectedNumber))
  const diff = useQuery({
    ...pullRequestDiffQueryOptions(projectId, currentRepositoryId, selectedNumber),
    enabled: Boolean(selectedNumber),
  })

  if (repositories.isPending) return <DelayedPageSkeleton />
  if (repositories.isError) {
    return <EmptyState title="仓库加载失败" description={describeRequestError(repositories.error).description} />
  }
  if (repositories.data.data.length === 0) {
    return <EmptyState mascot="aperture" title="尚未关联仓库" description="请先在项目设置中关联代码仓库。" />
  }
  return (
    <div className="project-tab-panel">
      <div className="row">
        <Select
          className="project-filter"
          aria-label="仓库"
          value={currentRepositoryId}
          onChange={(event) => {
            setRepositoryId(event.target.value)
            setSelectedNumber('')
          }}
        >
          {repositories.data.data.map((repository) => (
            <option key={repository.id} value={repository.id}>
              {repository.name}
            </option>
          ))}
        </Select>
        <Select
          className="project-filter"
          aria-label="PR 状态"
          value={state}
          onChange={(event) => setState(event.target.value as typeof state)}
        >
          <option value="">全部状态</option>
          <option value="open">打开</option>
          <option value="closed">已关闭</option>
        </Select>
      </div>
      {list.isPending ? (
        <DelayedLoading pending>
          <PageLoading />
        </DelayedLoading>
      ) : list.isError ? (
        <EmptyState title="PR 加载失败" description={describeRequestError(list.error).description} />
      ) : list.data.data.items.length === 0 ? (
        <EmptyState mascot="aperture" title="没有匹配的 PR" description="调整状态筛选或切换仓库后再试。" />
      ) : (
        <ul className="plain-list pr-list">
          {list.data.data.items.map((pullRequest) => (
            <li key={pullRequest.number}>
              <Button type="button" variant="link" onClick={() => setSelectedNumber(String(pullRequest.number))}>
                #{pullRequest.number} {pullRequest.title}
              </Button>
              <span className="tag">{STATE_LABELS[pullRequest.state] ?? pullRequest.state}</span>
              <span className="muted">{REVIEW_LABELS[pullRequest.reviewStatus] ?? pullRequest.reviewStatus}</span>
              <span className="muted">{pullRequest.authorName}</span>
            </li>
          ))}
        </ul>
      )}
      {selectedNumber ? (
        <section aria-label="PR 详情">
          {detail.isPending ? (
            <DelayedLoading pending>
              <PageLoading />
            </DelayedLoading>
          ) : detail.isError ? (
            <EmptyState title="PR 详情加载失败" description={describeRequestError(detail.error).description} />
          ) : (
            <div>
              <h3>
                #{detail.data.data.number} {detail.data.data.title}
              </h3>
              <p className="muted">
                {detail.data.data.sourceBranch} → {detail.data.data.targetBranch} ·{' '}
                {STATE_LABELS[detail.data.data.state]} · {detail.data.data.authorName}
              </p>
              <h4>变更文件</h4>
              {detail.data.data.files.length === 0 ? (
                <p className="muted">来源未返回变更文件。</p>
              ) : (
                <ul className="plain-list">
                  {detail.data.data.files.map((file) => (
                    <li key={file.path}>
                      <span>{file.path}</span>
                      <span className="muted">
                        +{file.additions} / -{file.deletions}
                        {file.binary ? ' · 二进制' : ''}
                        {file.truncated ? ' · 已截断' : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <h4>差异</h4>
              {diff.isPending ? (
                <DelayedLoading pending>
                  <PageLoading />
                </DelayedLoading>
              ) : diff.isError ? (
                <p className="muted">差异不可用：{describeRequestError(diff.error).description}</p>
              ) : (
                <pre className="code-view" aria-label="PR 差异">
                  {diff.data.data.patch}
                  {diff.data.data.truncated ? '\n…（内容已截断）' : ''}
                </pre>
              )}
            </div>
          )}
        </section>
      ) : null}
    </div>
  )
}

export default Component
