import { useLayoutEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { Download } from 'lucide-react'
import { formatFileSize, truncateFileName } from '@/features/attachments/lib/display'
import { AnswerFooter } from './answer-footer'
import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/ui/controls/button'
import { ConversationMarkdown } from './conversation-markdown'
import { ConversationWork } from './conversation-work'
import { ConversationMessageActions } from './conversation-message-actions'
import type { MessageView } from './conversation-message.view'

const clock = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' })
const FOLLOW_DISTANCE_PX = 72

function BotAnswer({ message }: { message: MessageView }) {
  const active = message.status === 'running' || message.status === 'queued'
  const [wasActive, setWasActive] = useState(active)
  if (active && !wasActive) setWasActive(true)
  if (!message.text) return null
  return (
    <div className="conversation-answer" data-reveal={wasActive || undefined}>
      <ConversationMarkdown text={message.text} running={false} />
    </div>
  )
}

/**
 * 以原型的消息流显示对话、输出进度和历史状态。
 * @param props 消息视图、空会话信息、历史加载、会话标识和权限。
 * @returns 可独立滚动的消息区。追加正文时仅跟随已经靠近底部的用户。
 */
export function ConversationMessages({
  items,
  roomName,
  showBotNames,
  intro,
  avatar,
  hasEarlier,
  loadingEarlier,
  loadEarlier,
  conversationId,
  readOnly,
  busy,
  isVisible,
}: {
  items: MessageView[]
  roomName: string
  showBotNames: boolean
  intro?: string
  avatar: React.ReactNode
  hasEarlier: boolean
  loadingEarlier: boolean
  loadEarlier: () => void
  conversationId: string
  readOnly: boolean
  busy: boolean
  isVisible: boolean
}) {
  const scrollBox = useRef<HTMLDivElement>(null)
  const transcript = useRef<HTMLDivElement>(null)
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
  }, [items.length, last?.id, last?.text, last?.status, last?.failureText, loadingEarlier, isVisible])

  useLayoutEffect(() => {
    const box = scrollBox.current
    if (!box || !isVisible) return
    // 草稿或附件撑高输入区时，只跟随原本就在消息末尾的读者。
    const observer = new ResizeObserver(() => {
      if (follow.current && historyOffset.current === null) box.scrollTop = box.scrollHeight
    })
    observer.observe(box)
    if (transcript.current) observer.observe(transcript.current)
    return () => observer.disconnect()
  }, [isVisible, isEmpty])

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
        <div className="dsh-messages" ref={transcript}>
          {items.map((message) => {
            const running = message.status === 'running'
            const time = message.time && (
              <time className={message.kind === 'user' ? undefined : 'dsh-time'} dateTime={message.time}>
                {clock.format(new Date(message.time))}
              </time>
            )
            return (
              <article
                key={message.runId ?? message.id}
                aria-label={message.kind === 'bot' ? message.name : undefined}
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
                    {message.attachments?.length ? (
                      <ul className="conversation-message-files" aria-label="消息附件">
                        {message.attachments.map(({ id, fileName, sizeBytes }) => (
                          <li key={id}>
                            <a
                              className="conversation-file-link"
                              href={`/api/v1/bot-conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(message.id)}/attachments/${encodeURIComponent(id)}/download`}
                              download={fileName}
                              aria-label={`下载 ${fileName}`}
                              title={fileName}
                            >
                              <Download size={16} aria-hidden="true" />
                              <span>{truncateFileName(fileName)}</span>
                              <small>{formatFileSize(sizeBytes)}</small>
                            </a>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {message.text && <div className="dsh-user-bubble">{message.text}</div>}
                    {message.failureText && (
                      <p className="dsh-user-failure" role="status">
                        {message.failureText}
                      </p>
                    )}
                    {(time || message.templateName || (!readOnly && message.isStored)) && (
                      <div className="dsh-user-meta row flex-wrap gap-2">
                        {time}
                        {message.templateName && <span className="small quiet">模板 /{message.templateName}</span>}
                        {!readOnly && message.isStored && (
                          <ConversationMessageActions message={message} conversationId={conversationId} busy={busy} />
                        )}
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    {message.kind === 'bot' && (
                      <ConversationWork message={message} conversationId={conversationId} showBotName={showBotNames} />
                    )}
                    {message.kind === 'bot' ? (
                      <BotAnswer message={message} />
                    ) : (
                      message.text && <div className="dsh-plain-text">{message.text}</div>
                    )}
                    {message.text && message.runId && !['running', 'queued'].includes(message.status ?? '') && (
                      <AnswerFooter message={message} conversationId={conversationId} readOnly={readOnly} busy={busy} />
                    )}
                    {!readOnly &&
                      message.isStored &&
                      !(message.text && message.runId && !['running', 'queued'].includes(message.status ?? '')) && (
                        <ConversationMessageActions message={message} conversationId={conversationId} busy={busy} />
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
