import type { ReactNode } from 'react'
import { Inbox } from 'lucide-react'
import { describeRequestError } from '@/shared/api/errors'
import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/ui/controls/button'

interface PageErrorProps {
  title: string
  /** 可选的业务说明，用于覆盖请求错误的默认文案。 */
  description?: string
  /** 请求错误用于生成可展示的说明和请求标识。 */
  error?: unknown
  requestId?: string | null
  retrying?: boolean
  retryLabel?: string
  /** 重新执行失败操作；由调用方处理异步状态和结果。 */
  onRetry?: () => void
}

/**
 * 展示可恢复的页面或查询错误，不暴露内部异常。
 * @param props 错误标题、安全说明、可选原始请求错误与请求标识，以及重试状态和回调。
 * @returns Bot 错误提示和可选重试入口；点击重试时调用提供的回调。
 */
export function PageError({
  title,
  description,
  error,
  requestId: providedRequestId,
  retrying = false,
  retryLabel = '重新检查',
  onRetry,
}: PageErrorProps) {
  const described = describeRequestError(error)
  const requestId = providedRequestId ?? described.requestId
  return (
    <div role="alert" aria-busy={retrying}>
      <EmptyState
        mascot="signal"
        title={title}
        description={
          <>
            {description ?? described.description}
            {requestId && <small className="mt-2 block text-xs break-all">请求标识：{requestId}</small>}
          </>
        }
        action={
          onRetry && (
            <Button type="button" className="min-h-11" onClick={onRetry} disabled={retrying}>
              {retrying ? '正在重试…' : retryLabel}
            </Button>
          )
        }
      />
    </div>
  )
}

export type EmptyStateMascot = 'orbit' | 'prism' | 'signal' | 'aperture' | 'group' | 'project'

interface EmptyStateProps {
  /** 标题，说明当前空状态的原因。 */
  title: string
  /** 标题层级；默认用于页面内部空状态。 */
  headingLevel?: 1 | 2 | 3
  /** 引导说明，告诉用户下一步可以做什么；不需要额外说明时可省略。 */
  description?: ReactNode
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
export function EmptyState({
  title,
  headingLevel = 3,
  description,
  mascot,
  icon,
  action,
  secondaryAction,
  className,
}: EmptyStateProps) {
  const Heading = headingLevel === 1 ? 'h1' : headingLevel === 2 ? 'h2' : 'h3'
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
      <Heading className={headingLevel === 3 ? undefined : 'text-xl font-semibold text-foreground'}>{title}</Heading>
      {description ? <p>{description}</p> : null}
      {(action || secondaryAction) && (
        <div className="empty-actions">
          {action}
          {secondaryAction}
        </div>
      )}
    </div>
  )
}
