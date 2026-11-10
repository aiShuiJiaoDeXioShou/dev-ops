import { useQuery } from '@tanstack/react-query'
import { describeRequestError } from '@/shared/api/errors'
import { Button } from '@/shared/ui/controls/button'
import { PageSkeleton } from '@/shared/ui/page-skeleton'
import { buildQueryOptions } from '../api/queries'

const STATUS_LABELS: Record<string, string> = {
  succeeded: '成功',
  failed: '失败',
  cancelled: '已取消',
  unknown: '未知',
}

/**
 * 构建记录详情面板；展示来源、产物引用、事项关联与更正历史，不代理外部文件。
 * @param props.buildId 构建记录标识。
 * @returns 只读详情；加载、失败、空态可区分。
 */
export function BuildDetailPanel({ buildId }: { buildId: string }) {
  const query = useQuery(buildQueryOptions(buildId))
  if (query.isPending) return <PageSkeleton />
  if (query.isError || !query.data) {
    const described = describeRequestError(query.error)
    return (
      <div className="empty" role="alert">
        <h3>构建详情加载失败</h3>
        <p>{described.description}</p>
        <Button type="button" onClick={() => void query.refetch()}>
          重新加载
        </Button>
      </div>
    )
  }
  const build = query.data.data
  return (
    <section className="build-detail" aria-label="构建详情">
      <header className="row spread">
        <h3>{build.versionLabel}</h3>
        <span className="tag">{STATUS_LABELS[build.resultStatus] ?? build.resultStatus}</span>
      </header>
      <dl className="build-detail-meta">
        <dt>构建标识</dt>
        <dd>{build.buildKey}</dd>
        <dt>来源</dt>
        <dd>{build.source}</dd>
        <dt>提交</dt>
        <dd>{build.commitRef ?? '未提供'}</dd>
        <dt>采集时间</dt>
        <dd>{build.collectedAt}</dd>
        <dt>说明</dt>
        <dd>{build.note ?? '无'}</dd>
      </dl>
      <section aria-label="产物引用">
        <h4>产物引用</h4>
        {build.artifacts.length === 0 ? (
          <p className="muted">没有产物引用。</p>
        ) : (
          <ul className="plain-list">
            {build.artifacts.map((artifact) => (
              <li key={artifact.id}>
                <span className="muted">{artifact.artifactType}</span>
                <a href={artifact.accessUrl} target="_blank" rel="noreferrer">
                  {artifact.versionLabel}
                </a>
                <span className="muted">{artifact.status}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-label="关联事项">
        <h4>关联事项</h4>
        {build.targets.length === 0 ? (
          <p className="muted">尚未关联需求或 Bug；关联不进入提测、不改变事项状态。</p>
        ) : (
          <ul className="plain-list">
            {build.targets.map((target) => (
              <li key={target.id}>
                <span className="muted">{target.targetType === 'requirement' ? '需求' : 'Bug'}</span>
                <span>
                  #{target.number} {target.title}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-label="更正历史">
        <h4>更正历史</h4>
        {build.corrections.length === 0 ? (
          <p className="muted">没有更正记录。</p>
        ) : (
          <ul className="plain-list">
            {build.corrections.map((correction) => (
              <li key={correction.id}>
                <span>{correction.correctedAt}</span>
                <span>{correction.reason}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  )
}
