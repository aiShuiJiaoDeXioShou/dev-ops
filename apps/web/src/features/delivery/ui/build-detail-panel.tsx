import { useQuery } from '@tanstack/react-query'
import { ExternalLink } from 'lucide-react'
import { formatDateTime } from '@/shared/lib/format'
import { Badge } from '@/shared/ui/controls/badge'
import { DetailSheetSkeleton } from '@/shared/ui/page-skeleton'
import { PageError } from '@/shared/ui/page-state'
import { StatusBadge, type StatusTone } from '@/shared/ui/status-badge'
import { buildQueryOptions } from '../api/queries'

const BUILD_STATUS_LABELS: Record<string, string> = {
  succeeded: '成功',
  failed: '失败',
  cancelled: '已取消',
  unknown: '未知',
}

const BUILD_STATUS_TONES: Record<string, StatusTone> = {
  succeeded: 'success',
  failed: 'danger',
  cancelled: 'neutral',
  unknown: 'warning',
}

const SOURCE_LABELS: Record<string, string> = {
  pipeline: '流水线',
  manual: '人工上报',
  local: '本地构建',
  external_system: '外部系统',
}

const ENV_LABELS: Record<string, string> = {
  development: '开发',
  test: '测试',
  production: '生产',
}

const ARTIFACT_TYPE_LABELS: Record<string, string> = {
  mobile_package: '移动安装包',
  mini_program_qr: '小程序二维码',
  web_test_url: '测试地址',
}

const ARTIFACT_STATUS_LABELS: Record<string, string> = {
  available: '可用',
  expired: '已失效',
  invalid: '无效',
}

/**
 * 构建记录详情面板；展示来源、产物引用、事项关联与更正历史，不代理外部文件。
 * @param props.buildId 构建记录标识。
 * @returns 只读详情；加载、失败、空态可区分。
 */
export function BuildDetailPanel({ buildId }: { buildId: string }) {
  const query = useQuery(buildQueryOptions(buildId))
  if (query.isPending) return <DetailSheetSkeleton propertyRows={5} label="构建详情加载中" />
  if (!query.data) {
    return (
      <PageError
        title="构建详情加载失败"
        error={query.error}
        retrying={query.isFetching}
        retryLabel="重新加载"
        onRetry={() => void query.refetch()}
      />
    )
  }
  const build = query.data.data
  const statusTone = BUILD_STATUS_TONES[build.resultStatus] ?? 'neutral'
  return (
    <section className="dlv-build-detail" aria-label="构建详情">
      <header className="dlv-build-head">
        <h3>{build.versionLabel}</h3>
        <StatusBadge tone={statusTone}>{BUILD_STATUS_LABELS[build.resultStatus] ?? build.resultStatus}</StatusBadge>
      </header>

      <dl className="dlv-meta-grid">
        <div className="dlv-meta-item">
          <dt>构建标识</dt>
          <dd className="mono">{build.buildKey}</dd>
        </div>
        <div className="dlv-meta-item">
          <dt>来源</dt>
          <dd>{SOURCE_LABELS[build.source] ?? build.source}</dd>
        </div>
        <div className="dlv-meta-item">
          <dt>环境</dt>
          <dd>{build.environment ? (ENV_LABELS[build.environment] ?? build.environment) : '未指定'}</dd>
        </div>
        <div className="dlv-meta-item">
          <dt>提交</dt>
          <dd className="mono">{build.commitRef ?? '未提供'}</dd>
        </div>
        <div className="dlv-meta-item full">
          <dt>采集时间</dt>
          <dd>{formatDateTime(build.collectedAt)}</dd>
        </div>
        <div className="dlv-meta-item full">
          <dt>说明</dt>
          <dd>{build.note ?? '无'}</dd>
        </div>
      </dl>

      <section className="dlv-detail-group" aria-label="产物引用">
        <h4>产物引用（{build.artifacts.length}）</h4>
        {build.artifacts.length === 0 ? (
          <p className="text-sm text-muted-foreground">没有产物引用。</p>
        ) : (
          <ul className="dlv-detail-cards">
            {build.artifacts.map((artifact) => (
              <li key={artifact.id} className="dlv-detail-card">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary">
                    {ARTIFACT_TYPE_LABELS[artifact.artifactType] ?? artifact.artifactType}
                  </Badge>
                  <a className="dlv-detail-link" href={artifact.accessUrl} target="_blank" rel="noreferrer">
                    <span>{artifact.versionLabel}</span>
                    <ExternalLink size={12} aria-hidden="true" />
                  </a>
                </div>
                <StatusBadge tone={artifact.status === 'available' ? 'success' : 'warning'}>
                  {ARTIFACT_STATUS_LABELS[artifact.status] ?? artifact.status}
                </StatusBadge>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="dlv-detail-group" aria-label="关联事项">
        <h4>关联事项（{build.targets.length}）</h4>
        {build.targets.length === 0 ? (
          <p className="text-sm text-muted-foreground">尚未关联需求或 Bug。</p>
        ) : (
          <ul className="dlv-detail-cards">
            {build.targets.map((target) => (
              <li key={target.id} className="dlv-detail-card">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={target.targetType === 'requirement' ? 'secondary' : 'destructive'}>
                    {target.targetType === 'requirement' ? '需求' : 'Bug'}
                  </Badge>
                  <span className="font-medium text-foreground">
                    #{target.number} {target.title}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="dlv-detail-group" aria-label="更正历史">
        <h4>更正历史（{build.corrections.length}）</h4>
        {build.corrections.length === 0 ? (
          <p className="text-sm text-muted-foreground">没有更正记录。</p>
        ) : (
          <ul className="dlv-detail-cards">
            {build.corrections.map((correction) => (
              <li key={correction.id} className="dlv-detail-card">
                <span className="text-xs text-muted-foreground">{formatDateTime(correction.correctedAt)}</span>
                <span className="text-foreground">{correction.reason}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  )
}
