import { useLayoutEffect, useRef } from 'react'
import { Bot } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import rehypeSanitize from 'rehype-sanitize'
import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/ui/controls/button'
import type { ConversationMessage } from '../api/queries'

type MessageView = {
  id: string
  name: string
  kind: ConversationMessage['speakerKind']
  text: string
  time?: string
  status?: string
}

const messageClock = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' })
const FOLLOW_DISTANCE_PX = 72

/** 按原型样式显示消息和当前增量回复；浏览历史期间保留滚动位置。 */
export function ConversationMessages({
  items,
  roomName,
  hasEarlier,
  loadingEarlier,
  loadEarlier,
}: {
  items: MessageView[]
  roomName: string
  hasEarlier: boolean
  loadingEarlier: boolean
  loadEarlier: () => void
}) {
  const scrollBox = useRef<HTMLDivElement>(null)
  const follow = useRef(true)
  const historyOffset = useRef<number | null>(null)
  const last = items.at(-1)

  useLayoutEffect(() => {
    const box = scrollBox.current
    if (!box) return
    if (historyOffset.current !== null && !loadingEarlier) {
      box.scrollTop = box.scrollHeight - historyOffset.current
      historyOffset.current = null
    } else if (follow.current) box.scrollTop = box.scrollHeight
  }, [items.length, last?.id, last?.text, last?.status, loadingEarlier])

  return (
    <div
      className="dsh-chat-scroll"
      ref={scrollBox}
      onScroll={(event) => {
        const box = event.currentTarget
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
          <span className="dsh-hero-avatar">
            <Bot className="icon fill-none stroke-current stroke-2" aria-hidden="true" />
          </span>
          <h2>{roomName}</h2>
        </div>
      ) : (
        <div className="dsh-messages">
          {items.map((message) => (
            <article
              key={message.id}
              className={cn('dsh-message', message.kind === 'user' ? 'dsh-user' : 'dsh-assistant dsh-plain-message')}
            >
              {message.kind === 'user' ? (
                <>
                  <div className="dsh-user-bubble">{message.text}</div>
                  {message.time && (
                    <div className="dsh-user-meta">
                      <time dateTime={message.time}>{messageClock.format(new Date(message.time))}</time>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div className="dsh-assistant-head">
                    <Bot className="icon fill-none stroke-current stroke-2" aria-hidden="true" />
                    <span className="dsh-author">{message.name}</span>
                    {message.time && (
                      <time className="dsh-time" dateTime={message.time}>
                        {messageClock.format(new Date(message.time))}
                      </time>
                    )}
                  </div>
                  {message.text && (
                    <div className="dsh-plain-text overflow-x-auto wrap-break-word">
                      <ReactMarkdown rehypePlugins={[rehypeSanitize]}>{message.text}</ReactMarkdown>
                    </div>
                  )}
                  {message.status && <p className="dsh-note">{message.status}</p>}
                </>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  )
}
