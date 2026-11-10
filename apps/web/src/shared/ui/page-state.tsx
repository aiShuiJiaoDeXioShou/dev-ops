import type { ReactNode } from 'react'
import { AlertCircle, Inbox } from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/controls/alert'
import { Button } from '@/shared/ui/controls/button'

/**
 * 展示页面或数据首次加载时的占位内容。
 * @param props.message 向辅助技术播报的加载说明，默认为页面加载中。
 * @returns 不依赖具体业务的加载状态，不发起请求。
 */
export function PageLoading({ message = '页面加载中…' }: { message?: string }) {
  return (
    <div role="status" aria-busy="true" className="space-y-4 py-6">
      <p className="small quiet">{message}</p>
      <span className="skeleton-line skeleton-title" />
      <span className="skeleton-line skeleton-subtitle" />
      <span className="skeleton-line skeleton-card-line" />
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
export function PageError({
  title,
  description,
  requestId,
  retrying = false,
  retryLabel = '重新检查',
  onRetry,
}: PageErrorProps) {
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
      {onRetry && (
        <Button variant="outline" onClick={onRetry} disabled={retrying}>
          {retrying ? '检查中…' : retryLabel}
        </Button>
      )}
    </div>
  )
}

export type EmptyStateMascot = 'orbit' | 'prism' | 'signal' | 'aperture' | 'group' | 'project'

interface EmptyStateProps {
  /** 标题，说明当前空状态的原因。 */
  title: string
  /** 引导说明，告诉用户下一步可以做什么。 */
  description: string
  /** 团队/项目类场景使用的 Bot 吉祥物；与 icon 二选一。 */
  mascot?: EmptyStateMascot
  /** 搜索结果、错误等场景使用的线性图标；与 mascot 二选一。 */
  icon?: ReactNode
  /** 主操作，例如创建项目或清除筛选。 */
  action?: ReactNode
  /** 次操作，例如返回上一级。 */
  secondaryAction?: ReactNode
  /** 附加布局类名，用于窄面板或页面级空状态。 */
  className?: string
}

/**
 * 展示无数据、无团队、搜索无结果等明确的空状态。
 * @param props 标题、说明、可选 Bot 吉祥物或图标、操作入口。
 * @returns 统一风格的空状态区域；吉祥物带轻微动效，图标用于功能性空结果。
 */
export function EmptyState({ title, description, mascot, icon, action, secondaryAction, className }: EmptyStateProps) {
  return (
    <div className={cn('empty empty-state', className)}>
      {mascot === 'group' ? (
        <div className="empty-art empty-art-group" aria-hidden="true">
          <span className="empty-orbit" />
          <img className="bot-side left" src="/prototype/bots/bot-prism-live.svg" width={54} height={54} alt="" />
          <img className="bot-side right" src="/prototype/bots/bot-signal-live.svg" width={54} height={54} alt="" />
          <img className="bot-main" src="/prototype/bots/bot-orbit-live.svg" width={88} height={88} alt="" />
        </div>
      ) : mascot === 'project' ? (
        <div className="empty-art empty-art-project" aria-hidden="true">
          <span className="empty-orbit" />
          <img className="bot-main" src="/prototype/bots/bot-orbit-live.svg" width={84} height={84} alt="" />
          <div className="empty-project-preview">
            <div className="empty-project-row">
              <span className="empty-project-folder" />
              <span className="empty-project-bar long" />
              <span className="empty-project-dot green" />
            </div>
            <div className="empty-project-row">
              <span className="empty-project-dot blue" />
              <span className="empty-project-bar" />
            </div>
            <div className="empty-project-row">
              <span className="empty-project-dot amber" />
              <span className="empty-project-bar short" />
            </div>
          </div>
        </div>
      ) : mascot ? (
        <div className="empty-art" aria-hidden="true">
          <span className="empty-orbit" />
          <span className="empty-orbit-dot dot blue" />
          <img src={`/prototype/bots/bot-${mascot}-live.svg`} width={96} height={96} alt="" />
        </div>
      ) : (
        <div className="empty-art empty-art-icon" aria-hidden="true">
          <span className="empty-mark">{icon ?? <Inbox />}</span>
        </div>
      )}
      <h3>{title}</h3>
      <p>{description}</p>
      {(action || secondaryAction) && (
        <div className="empty-actions">
          {action}
          {secondaryAction}
        </div>
      )}
    </div>
  )
}
