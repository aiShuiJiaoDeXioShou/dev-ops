import type { ReactNode } from 'react'
import { LoaderCircle } from 'lucide-react'
import { DelayedLoading } from '@/shared/ui/delayed-loading'
import './conversations.css'

/**
 * 渲染宽度与真实会话行一致的占位，供列表和协作首屏复用。
 * @param props.delay 已经过外层延迟时传入 0，其余情况沿用共享延迟。
 * @returns 会话列表的加载占位。
 */
export function ConversationListSkeleton({ delay }: { delay?: number }) {
  return (
    <DelayedLoading pending delay={delay}>
      <div className="conversation-loading-rows" role="status" aria-label="会话列表加载中">
        {[0, 1, 2].map((row) => (
          <div key={row} className="conversation-item" aria-hidden="true">
            <div className="conversation-mark">
              <span className="conversation-placeholder size-8 rounded-full" />
            </div>
            <div className="conversation-summary space-y-2">
              <span className="conversation-placeholder h-2.5 w-2/5" />
              <span className="conversation-placeholder h-2.5 w-3/4" />
            </div>
          </div>
        ))}
      </div>
    </DelayedLoading>
  )
}

/**
 * 在会话主区显示局部加载提示，先保留该区域的空间，慢请求才显示指示器。
 * @param props.message 描述正在等待的内容，同时用于读屏。
 * @param props.delay 已经过外层延迟时传入 0，其余情况沿用共享延迟。
 * @returns 占据可用主区的加载提示。
 */
export function ConversationLoading({ message, delay }: { message: string; delay?: number }) {
  return (
    <div className="conversation-loading-status">
      <DelayedLoading pending delay={delay}>
        <span className="inline-flex items-center gap-2 text-xs text-muted-foreground" role="status">
          <LoaderCircle className="size-3.5 motion-safe:animate-spin" aria-hidden="true" />
          {message}
        </span>
      </DelayedLoading>
    </div>
  )
}

/**
 * 等待会话详情时保留标题与正文的位置，窄屏仍可通过已就绪的入口打开会话列表。
 * @param props.listToggle 可用的窄屏列表入口，首屏尚未建立导航时省略。
 * @param props.readOnly 已知会话为只读时省略输入区占位。
 * @param props.delay 已经过外层延迟时传入 0，其余情况沿用共享延迟。
 * @returns 协作主区的加载视图。
 */
export function ConversationRoomSkeleton({
  listToggle,
  readOnly = false,
  delay,
}: {
  listToggle?: ReactNode
  readOnly?: boolean
  delay?: number
}) {
  return (
    <section className="conversation-main dsh-chat conversation-loading-room">
      <header className="dsh-chat-header">
        <div className="dsh-title-row">
          {listToggle ?? <span className="dsh-room-toggle size-8 shrink-0" aria-hidden="true" />}
          <DelayedLoading pending delay={delay}>
            <div className="dsh-title" aria-hidden="true">
              <span className="conversation-placeholder size-7 rounded-full" />
              <div className="dsh-title-text">
                <span className="flex h-5 items-center">
                  <span className="conversation-placeholder h-2.5 w-24" />
                </span>
                <span className="flex h-4 items-center">
                  <span className="conversation-placeholder h-2.5 w-16" />
                </span>
              </div>
            </div>
          </DelayedLoading>
        </div>
        <DelayedLoading pending delay={delay}>
          <div className="dsh-tabs" aria-hidden="true">
            <div className="dsh-tab">
              <span className="conversation-placeholder h-2.5 w-6" />
            </div>
            <div className="dsh-tab">
              <span className="conversation-placeholder h-2.5 w-6" />
            </div>
          </div>
        </DelayedLoading>
      </header>
      <ConversationLoading message="正在加载会话…" delay={delay} />
      {!readOnly && (
        <div className="dsh-composer invisible" aria-hidden="true">
          <div className="h-7" />
          <div className="dsh-composer-bar h-8" />
        </div>
      )}
    </section>
  )
}

/**
 * 在路由、认证或团队尚未就绪时占住协作分栏。
 * @param props.mobileNavigation 团队加载期间可用的窄屏主导航入口。
 * @param props.delay 已经过外层延迟时传入 0，其余情况沿用共享延迟。
 * @returns 与协作页面同宽的会话侧栏和加载中的会话主区。
 */
export function CollaborationPageSkeleton({
  mobileNavigation,
  delay,
}: {
  mobileNavigation?: ReactNode
  delay?: number
}) {
  return (
    <div className="collab-layout live-conversations">
      <div className="conversation-list">
        <DelayedLoading pending delay={delay}>
          <div className="row conv-tools" aria-hidden="true">
            <span className="conversation-placeholder h-8 min-w-0 flex-1" />
            <span className="conversation-placeholder size-8" />
            <span className="conversation-placeholder size-8" />
          </div>
          <div className="inbox-link" aria-hidden="true">
            <span className="conversation-placeholder h-2.5 w-20" />
          </div>
        </DelayedLoading>
        <ConversationListSkeleton delay={delay} />
      </div>
      <ConversationRoomSkeleton listToggle={mobileNavigation} delay={delay} />
    </div>
  )
}
