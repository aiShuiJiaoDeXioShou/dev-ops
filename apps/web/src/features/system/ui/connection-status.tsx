import { useQuery } from '@tanstack/react-query'
import { CheckCircle2, RefreshCw } from 'lucide-react'
import { Badge } from '@/shared/ui/controls/badge'
import { Button } from '@/shared/ui/controls/button'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/shared/ui/controls/card'
import { PageError, PageLoading } from '@/shared/ui/page-state'
import { readinessQueryOptions } from '../api/queries'
import { RequestError } from '@dev-ops/api-client'

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

  /**
   * 请求最新就绪状态，由 Query 保存结果或错误。
   * @returns 无返回值；查询期间禁用重复操作。
   */
  function refreshStatus() {
    void query.refetch()
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <CardTitle>服务连接</CardTitle>
        <Badge variant={query.isError ? 'destructive' : 'secondary'}>{statusLabel}</Badge>
      </CardHeader>
      <CardContent>
        {query.isPending && <PageLoading message="正在检查后端与数据库…" />}
        {query.isError && (
          <PageError
            title="连接检查失败"
            description={
              requestError?.status === 503
                ? '数据库尚未就绪，请检查数据库服务和迁移。'
                : (requestError?.message ?? '暂时无法读取系统状态，请稍后重试。')
            }
            requestId={requestError?.requestId}
            onRetry={refreshStatus}
            retrying={query.isFetching}
          />
        )}
        {query.isSuccess && (
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
              <div>
                <p role="status" aria-live="polite" className="text-sm font-medium">
                  {query.isFetching ? '正在更新连接状态…' : '已联通：前端 → API 代理 → 后端 → PostgreSQL'}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  最近检查：{new Date(query.dataUpdatedAt).toLocaleTimeString('zh-CN', { hour12: false })}
                </p>
              </div>
            </div>
            {query.data.requestId && (
              <p className="break-all rounded-lg bg-muted/60 px-3 py-2 font-mono text-xs text-muted-foreground">
                请求标识：{query.data.requestId}
              </p>
            )}
          </div>
        )}
      </CardContent>
      {!query.isError && (
        <CardFooter className="border-t pt-4">
          <Button variant="outline" size="sm" onClick={refreshStatus} disabled={query.isFetching}>
            <RefreshCw className={query.isFetching ? 'animate-spin' : undefined} aria-hidden="true" />
            {query.isFetching ? '检查中…' : '重新检查'}
          </Button>
        </CardFooter>
      )}
    </Card>
  )
}
