import { useQuery } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import { RequestError } from '@dev-ops/api-client'
import { readinessQueryOptions } from '../api/queries'

/**
 * 使用共享查询缓存展示后端与数据库状态。
 * @returns 连接状态卡片；首次加载展示占位，失败可重试，离开页面时取消未完成请求。
 */
export default function ConnectionStatus() {
  const query = useQuery(readinessQueryOptions)
  const requestError = query.error instanceof RequestError ? query.error : null
  let statusLabel = '已联通'
  if (query.isError) statusLabel = '连接失败'
  if (query.isFetching) statusLabel = '检查中'
  const refreshStatus = () => void query.refetch()
  return (
    <section className="card">
      <div className="row spread">
        <h3>服务连接</h3>
        <span className={query.isError ? 'badge red' : 'badge'}>{statusLabel}</span>
      </div>
      {query.isPending && <p className="section-note">正在检查后端与数据库…</p>}
      {query.isError && (
        <div className="error-box" role="alert">
          <strong>连接检查失败</strong>
          <p>
            {requestError?.status === 503
              ? '数据库尚未就绪，请检查数据库服务和迁移。'
              : (requestError?.message ?? '暂时无法读取系统状态，请稍后重试。')}
          </p>
          {requestError?.requestId && <p className="request-id">请求标识：{requestError.requestId}</p>}
        </div>
      )}
      {query.isSuccess && (
        <>
          <div className="row" style={{ marginTop: 16, alignItems: 'flex-start' }}>
            <span className="dot green" style={{ marginTop: 7 }} />
            <div>
              <p role="status" aria-live="polite" style={{ fontWeight: 500 }}>
                {query.isFetching ? '正在更新连接状态…' : '已联通：前端 → API 代理 → 后端 → PostgreSQL'}
              </p>
              <p className="quiet small" style={{ marginTop: 6 }}>
                最近检查：{new Date(query.dataUpdatedAt).toLocaleTimeString('zh-CN', { hour12: false })}
              </p>
            </div>
          </div>
          {query.data.requestId && <p className="request-id">请求标识：{query.data.requestId}</p>}
        </>
      )}
      <div className="row" style={{ marginTop: 18 }}>
        <button type="button" className="btn" onClick={refreshStatus} disabled={query.isFetching}>
          <RefreshCw className={query.isFetching ? 'animate-spin' : undefined} aria-hidden="true" />
          {query.isFetching ? '检查中…' : '重新检查'}
        </button>
      </div>
    </section>
  )
}
