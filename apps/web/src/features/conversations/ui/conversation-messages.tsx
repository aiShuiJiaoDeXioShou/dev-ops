import { useLayoutEffect, useRef } from 'react'
import { Link } from 'react-router'
import ReactMarkdown from 'react-markdown'
import rehypeSanitize from 'rehype-sanitize'
import remarkGfm from 'remark-gfm'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/shared/ui/controls/table'
import { AnswerFooter } from './answer-footer'
import { BotAvatar } from '@/features/bots/ui/bot-avatar'
import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/ui/controls/button'
import type { MessageView } from './conversation-message.view'

const clock = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' })
const FOLLOW_DISTANCE_PX = 72

/**
 * 以原型的消息流显示对话、输出进度和历史状态。
 * @param props 消息视图、空会话信息、历史加载、会话标识和权限。
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
  conversationId,
  readOnly,
  isVisible,
}: {
  items: MessageView[]
  roomName: string
  intro?: string
  avatar: React.ReactNode
  hasEarlier: boolean
  loadingEarlier: boolean
  loadEarlier: () => void
  conversationId: string
  readOnly: boolean
  isVisible: boolean
}) {
  const scrollBox = useRef<HTMLDivElement>(null)
  const follow = useRef(true)
  const linkedMessage = useRef<string | null>(null)
  const historyOffset = useRef<number | null>(null)
  const last = items.at(-1)
  const isEmpty = !last && !hasEarlier

  useLayoutEffect(() => {
    const box = scrollBox.current
    if (!box || !isVisible) return
    const targetId = window.location.hash.slice(1)
    const target = targetId.startsWith('message-') ? document.getElementById(targetId) : null
    if (target && box.contains(target) && linkedMessage.current !== targetId) {
      linkedMessage.current = targetId
      follow.current = false
      target.scrollIntoView({ block: 'center' })
      return
    }
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
                id={`message-${message.id}`}
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
                    </div>
                    {message.text && message.runId ? (
                      <div className="md-body dsh-markdown">
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          rehypePlugins={[rehypeSanitize]}
                          components={{
                            table: ({ children }) => <Table>{children}</Table>,
                            thead: ({ children }) => <TableHeader>{children}</TableHeader>,
                            tbody: ({ children }) => <TableBody>{children}</TableBody>,
                            tr: ({ children }) => <TableRow>{children}</TableRow>,
                            th: ({ children }) => <TableHead scope="col">{children}</TableHead>,
                            td: ({ children }) => <TableCell>{children}</TableCell>,
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
                    {message.status && ['running', 'queued', 'stopped', 'failed'].includes(message.status) && (
                      <div className="dsh-message-foot" role="status">
                        {running && <span className="dsh-pulse" aria-hidden="true" />}
                        {message.statusText && (
                          <span className={message.status === 'stopped' ? 'dsh-stopped' : undefined}>
                            {message.statusText}
                          </span>
                        )}
                        {message.status === 'stopped' && message.text && <span>已保留部分结果</span>}
                      </div>
                    )}
                    {message.text && message.runId && !['running', 'queued'].includes(message.status ?? '') && (
                      <AnswerFooter message={message} conversationId={conversationId} readOnly={readOnly} />
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
