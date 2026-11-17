import { useLayoutEffect, useRef } from 'react'
import { Link } from 'react-router'
import ReactMarkdown from 'react-markdown'
import rehypeSanitize from 'rehype-sanitize'
import { BotAvatar } from '@/features/bots/ui/bot-avatar'
import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/ui/controls/button'
import type { ConversationMessage } from '../api/queries'

export type MessageView = {
  id: string
  runId?: string
  name: string
  kind: ConversationMessage['speakerKind']
  text: string
  time?: string
  bot?: { id: string; avatarKey?: string | null; enabled?: boolean }
  status?: string
  statusText?: string
  elapsed?: string
  memoryChanges?: string[]
}

const clock = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' })
const FOLLOW_DISTANCE_PX = 72

/**
 * 以原型的消息流显示对话、输出进度和历史状态。
 * @param props 消息视图、空会话信息、历史加载及查看轨迹入口。
 * @returns 可独立滚动的消息区。追加正文时仅跟随已经靠近底部的用户。
 */
export function ConversationMessages({
  items,
  roomName,
  intro,
  avatar,
  hasEarlier,
  loadingEarlier,
  loadEarlier,
  onTrace,
  isVisible,
}: {
  items: MessageView[]
  roomName: string
  intro?: string
  avatar: React.ReactNode
  hasEarlier: boolean
  loadingEarlier: boolean
  loadEarlier: () => void
  onTrace: (runId: string) => void
  isVisible: boolean
}) {
  const scrollBox = useRef<HTMLDivElement>(null)
  const follow = useRef(true)
  const historyOffset = useRef<number | null>(null)
  const last = items.at(-1)
  const isEmpty = !last && !hasEarlier

  useLayoutEffect(() => {
    const box = scrollBox.current
    if (!box || !isVisible) return
    if (historyOffset.current !== null && !loadingEarlier) {
      box.scrollTop = box.scrollHeight - historyOffset.current
      historyOffset.current = null
    } else if (follow.current && last?.id) box.scrollTop = box.scrollHeight
  }, [items.length, last?.id, last?.text, last?.status, loadingEarlier, isVisible])

  return (
    <div
      className={cn('dsh-chat-scroll', isEmpty && 'is-empty')}
      ref={scrollBox}
      onScroll={(event) => {
        const box = event.currentTarget
        if (!box.clientHeight) return
        follow.current = box.scrollHeight - box.clientHeight - box.scrollTop <= FOLLOW_DISTANCE_PX
      }}
    >
      {hasEarlier && (
        <div className="row justify-center">
          <Button
            type="button"
            variant="ghost"
            disabled={loadingEarlier}
            onClick={() => {
              const box = scrollBox.current
              if (box) historyOffset.current = box.scrollHeight - box.scrollTop
              loadEarlier()
            }}
          >
            {loadingEarlier ? '正在加载…' : '加载更早消息'}
          </Button>
        </div>
      )}
      {items.length === 0 ? (
        <div className="dsh-hero">
          <span className="dsh-hero-avatar">{avatar}</span>
          <h1>{roomName}</h1>
          {intro && <p>{intro}</p>}
        </div>
      ) : (
        <div className="dsh-messages">
          {items.map((message) => {
            const running = message.status === 'running'
            const time = message.time && (
              <time className={message.kind === 'user' ? undefined : 'dsh-time'} dateTime={message.time}>
                {clock.format(new Date(message.time))}
              </time>
            )
            return (
              <article
                key={message.id}
                className={cn(
                  'dsh-message',
                  message.kind === 'user' ? 'dsh-user' : 'dsh-assistant',
                  running && 'is-streaming',
                  message.status === 'stopped' && 'is-stopped',
                )}
              >
                {message.kind === 'user' ? (
                  <>
                    <div className="dsh-user-bubble">{message.text}</div>
                    {time && <div className="dsh-user-meta">{time}</div>}
                  </>
                ) : (
                  <>
                    <div className="dsh-assistant-head">
                      {message.bot && (
                        <BotAvatar
                          botId={message.bot.id}
                          avatarKey={message.bot.avatarKey ?? null}
                          enabled={message.bot.enabled}
                        />
                      )}
                      <span className="dsh-author">{message.name}</span>
                      {time}
                    </div>
                    {message.text && message.runId ? (
                      <div className="md-body dsh-markdown">
                        <ReactMarkdown
                          rehypePlugins={[rehypeSanitize]}
                          components={{
                            p: ({ children, node }) => (
                              <p>
                                {children}
                                {running && node?.position?.end.offset === message.text.trimEnd().length && (
                                  <span className="dsh-cursor" aria-hidden="true" />
                                )}
                              </p>
                            ),
                          }}
                        >
                          {message.text.trimEnd()}
                        </ReactMarkdown>
                      </div>
                    ) : (
                      message.text && <div className="dsh-plain-text">{message.text}</div>
                    )}
                    {running && !message.text && <p className="dsh-waiting">正在准备回复…</p>}
                    {(message.statusText || message.elapsed || message.runId) && (
                      <div className="dsh-message-foot">
                        {running && <span className="dsh-pulse" aria-hidden="true" />}
                        {message.statusText && (
                          <span className={message.status === 'stopped' ? 'dsh-stopped' : undefined}>
                            {message.statusText}
                          </span>
                        )}
                        {message.elapsed && <span>{message.elapsed}</span>}
                        {message.status === 'stopped' && message.text && <span>已保留部分结果</span>}
                        {message.runId && (
                          <Button
                            unstyled
                            type="button"
                            className="dsh-link"
                            onClick={() => {
                              if (message.runId) onTrace(message.runId)
                            }}
                          >
                            查看轨迹
                          </Button>
                        )}
                      </div>
                    )}
                    {message.memoryChanges?.map((action, index) => (
                      <details key={index} className="dsh-note">
                        <summary>
                          {action === 'remove' ? '已删除记忆' : action === 'patch' ? '已更新记忆' : '已记住'}
                        </summary>
                        <Link to="/capabilities/memory">查看长期记忆</Link>
                      </details>
                    ))}
                  </>
                )}
              </article>
            )
          })}
        </div>
      )}
    </div>
  )
}
