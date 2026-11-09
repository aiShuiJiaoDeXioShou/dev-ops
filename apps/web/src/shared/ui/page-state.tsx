import type { ReactNode } from 'react'
import { AlertCircle, FolderOpen } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/controls/alert'
import { Button } from '@/shared/ui/controls/button'
import { Skeleton } from '@/shared/ui/controls/skeleton'

/**
 * 展示页面或数据首次加载时的占位内容。
 * @param props.message 向辅助技术播报的加载说明，默认为页面加载中。
 * @returns 不依赖具体业务的加载状态，不发起请求。
 */
export function PageLoading({ message = '页面加载中…' }: { message?: string }) {
  return (
    <div role="status" aria-busy="true" className="space-y-4 py-6">
      <p className="text-sm text-muted-foreground">{message}</p>
      <Skeleton className="h-5 w-40" />
      <Skeleton className="h-4 w-full max-w-md" />
      <Skeleton className="h-4 w-2/3 max-w-xs" />
    </div>
  )
}

interface PageErrorProps {
  title: string
  description: string
  requestId?: string | null
  retrying?: boolean
  retryLabel?: string
  /** 重新执行失败操作；由调用方处理异步状态和结果。 */
  onRetry?: () => void
}

/**
 * 展示可恢复的页面或查询错误，不暴露内部异常。
 * @param props 错误标题、安全说明、可选请求标识及重试状态和回调。
 * @returns 错误提示和可选重试入口；点击重试时调用提供的回调。
 */
export function PageError({ title, description, requestId, retrying = false, retryLabel = '重新检查', onRetry }: PageErrorProps) {
  return (
    <div className="space-y-4">
      <Alert variant="destructive">
        <AlertCircle aria-hidden="true" />
        <AlertTitle>{title}</AlertTitle>
        <AlertDescription>
          <p>{description}</p>
          {requestId && <p className="break-all text-xs">请求标识：{requestId}</p>}
        </AlertDescription>
      </Alert>
      {onRetry && <Button variant="outline" onClick={onRetry} disabled={retrying}>{retrying ? '检查中…' : retryLabel}</Button>}
    </div>
  )
}

/**
 * 展示功能尚未开放、无数据或未找到页面等明确的空状态。
 * @param props 标题、说明及可选操作，内容由具体页面提供。
 * @returns 可复用的空状态区域，不推断业务数据是否存在。
 */
export function EmptyState({ title, description, action }: {
  title: string
  description: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      <div className="mb-5 rounded-2xl border bg-muted/50 p-4">
        <FolderOpen className="size-7 text-muted-foreground" aria-hidden="true" />
      </div>
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">{description}</p>
      {action && <div className="mt-6">{action}</div>}
    </div>
  )
}
