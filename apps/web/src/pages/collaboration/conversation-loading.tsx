import type { ReactNode } from 'react'
import { DelayedLoading } from '@/shared/ui/delayed-loading'
import { Skeleton } from '@/shared/ui/controls/skeleton'
import './conversations.css'

/**
 * 渲染宽度与真实会话行一致的骨架占位，供会话列表和协作首屏复用。
 * @param props.delay 已经过外层延迟时传入 0，其余情况沿用共享延迟。
 * @returns 会话列表的结构化骨架。
 */
export function ConversationListSkeleton({ delay }: { delay?: number }) {
  return (
    <DelayedLoading pending delay={delay}>
      <div className="conversation-loading-rows" role="status" aria-busy="true" aria-label="会话列表加载中">
        {[0, 1, 2, 3, 4].map((row) => (
          <div key={row} className="conversation-item" aria-hidden="true">
            <div className="conversation-mark">
              <Skeleton circle width={32} height={32} />
            </div>
            <div className="conversation-summary space-y-2">
              <Skeleton width={row % 2 === 0 ? '45%' : '58%'} height={12} />
              <Skeleton width={row % 2 === 0 ? '78%' : '66%'} height={10} />
            </div>
          </div>
        ))}
      </div>
    </DelayedLoading>
  )
}

/**
 * 协作对话消息流的交错气泡骨架，还原 Bot 左侧长回复与用户右侧消息的排版。
 * @param props.delay 已经过外层延迟时传入 0，其余情况沿用共享延迟。
 * @returns 对话消息区的纯骨架占位。
 */
export function ConversationMessagesSkeleton({ delay }: { delay?: number }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-hidden px-5 py-6">
      <DelayedLoading pending delay={delay}>
        <div role="status" aria-busy="true" aria-label="会话消息加载中" className="mx-auto w-full max-w-3xl space-y-6">
          <div className="flex justify-end" aria-hidden="true">
            <div className="w-3/5 max-w-md space-y-2 rounded-2xl border border-border bg-secondary/40 p-3.5">
              <Skeleton width="88%" height={13} />
              <Skeleton width="52%" height={13} />
            </div>
          </div>
          <div className="flex items-start gap-3" aria-hidden="true">
            <Skeleton circle width={30} height={30} />
            <div className="min-w-0 flex-1 space-y-2.5">
              <div className="flex items-center gap-2">
                <Skeleton width={76} height={13} />
                <Skeleton width={48} height={11} />
              </div>
              <Skeleton width="92%" height={13} />
              <Skeleton width="84%" height={13} />
              <Skeleton width="60%" height={13} />
            </div>
          </div>
          <div className="flex justify-end" aria-hidden="true">
            <div className="w-2/5 max-w-xs space-y-2 rounded-2xl border border-border bg-secondary/40 p-3.5">
              <Skeleton width="76%" height={13} />
            </div>
          </div>
          <div className="flex items-start gap-3" aria-hidden="true">
            <Skeleton circle width={30} height={30} />
            <div className="min-w-0 flex-1 space-y-2.5">
              <div className="flex items-center gap-2">
                <Skeleton width={88} height={13} />
                <Skeleton width={48} height={11} />
              </div>
              <Skeleton width="86%" height={13} />
              <Skeleton width="70%" height={13} />
            </div>
          </div>
        </div>
      </DelayedLoading>
    </div>
  )
}

/**
 * 协作轨迹页签的时间线与详情分栏骨架。
 * @param props.delay 已经过外层延迟时传入 0，其余情况沿用共享延迟。
 * @returns 轨迹视图的纯骨架占位。
 */
export function ConversationTrajectorySkeleton({ delay }: { delay?: number }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden p-5">
      <DelayedLoading pending delay={delay}>
        <div role="status" aria-busy="true" aria-label="运行轨迹加载中" className="space-y-4">
          <div className="flex flex-wrap items-center gap-2" aria-hidden="true">
            <Skeleton width={180} height={32} borderRadius="var(--radius-md)" />
            <Skeleton width={76} height={28} borderRadius="var(--radius-full)" />
            <Skeleton width={76} height={28} borderRadius="var(--radius-full)" />
            <Skeleton width={76} height={28} borderRadius="var(--radius-full)" />
          </div>
          <div className="grid gap-4 lg:grid-cols-5" aria-hidden="true">
            <div className="space-y-3 lg:col-span-2">
              {[0, 1, 2, 3, 4].map((step) => (
                <div key={step} className="rounded-lg border border-border p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <Skeleton width={110} height={13} />
                    <Skeleton width={46} height={11} />
                  </div>
                  <Skeleton width="82%" height={11} />
                </div>
              ))}
            </div>
            <div className="rounded-lg border border-border p-4 space-y-3 lg:col-span-3">
              <Skeleton width="44%" height={16} />
              <Skeleton width="94%" height={12} />
              <Skeleton width="88%" height={12} />
              <Skeleton width="76%" height={12} />
              <Skeleton width="100%" height={110} borderRadius="var(--radius-md)" />
            </div>
          </div>
        </div>
      </DelayedLoading>
    </div>
  )
}

/**
 * 等待会话详情时保留标题、页签、消息流与输入区位置，窄屏仍可通过已就绪的入口打开会话列表。
 * @param props.listToggle 可用的窄屏列表入口，首屏尚未建立导航时省略。
 * @param props.readOnly 已知会话为只读时省略输入区占位。
 * @param props.delay 已经过外层延迟时传入 0，其余情况沿用共享延迟。
 * @returns 协作主区的结构化加载骨架。
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
              <Skeleton circle width={28} height={28} />
              <div className="dsh-title-text space-y-1">
                <Skeleton width={104} height={13} />
                <Skeleton width={68} height={10} />
              </div>
            </div>
          </DelayedLoading>
        </div>
        <DelayedLoading pending delay={delay}>
          <div className="dsh-tabs" aria-hidden="true">
            <div className="dsh-tab">
              <Skeleton width={32} height={12} />
            </div>
            <div className="dsh-tab">
              <Skeleton width={32} height={12} />
            </div>
          </div>
        </DelayedLoading>
      </header>
      <ConversationMessagesSkeleton delay={delay} />
      {!readOnly && (
        <div className="dsh-composer" aria-hidden="true">
          <DelayedLoading pending delay={delay}>
            <div className="space-y-2.5">
              <Skeleton width="42%" height={16} />
              <div className="flex items-center justify-between pt-1">
                <Skeleton width={28} height={28} borderRadius="var(--radius-md)" />
                <Skeleton width={68} height={28} borderRadius="var(--radius-md)" />
              </div>
            </div>
          </DelayedLoading>
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
            <div className="min-w-0 flex-1">
              <Skeleton width="100%" height={32} borderRadius="var(--radius-md)" />
            </div>
            <Skeleton width={32} height={32} borderRadius="var(--radius-md)" />
            <Skeleton width={32} height={32} borderRadius="var(--radius-md)" />
          </div>
          <div className="inbox-link" aria-hidden="true">
            <Skeleton width={88} height={12} />
          </div>
        </DelayedLoading>
        <ConversationListSkeleton delay={delay} />
      </div>
      <ConversationRoomSkeleton listToggle={mobileNavigation} delay={delay} />
    </div>
  )
}
