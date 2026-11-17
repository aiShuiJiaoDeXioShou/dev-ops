import { useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Plus, Send } from 'lucide-react'
import { apiClient } from '@/shared/api/client'
import { describeRequestError } from '@/shared/api/errors'
import { Button } from '@/shared/ui/controls/button'
import { Textarea } from '@/shared/ui/controls/textarea'
import type { BotConversation } from '../api/queries'

function activeMention(text: string) {
  return /(?:^|\s)@([^\s@]*)$/u.exec(text)
}

function stringWithMention(text: string, name: string) {
  return `${text.replace(/@[^\s@]*$/u, '')}@${name} `
}

/** 复用对话原型的输入区，发送失败时用原请求标识重试同一草稿。 */
export function ConversationComposer({
  room,
  readOnly,
  onSent,
}: {
  room: BotConversation
  readOnly: boolean
  onSent: () => void
}) {
  const [draft, setDraft] = useState('')
  const [hideMentions, setHideMentions] = useState(false)
  const [selected, setSelected] = useState<BotConversation['members'][number]>()
  const input = useRef<HTMLTextAreaElement>(null)
  const requestId = useRef<string>(undefined)
  const mention = hideMentions ? undefined : activeMention(draft)?.[1]
  const candidates =
    mention === undefined
      ? []
      : room.members.filter(
          (member) => member.kind === 'bot' && member.name.toLowerCase().includes(mention.toLowerCase()),
        )
  const send = useMutation({
    mutationFn: () => {
      const id = requestId.current ?? crypto.randomUUID()
      requestId.current = id
      return apiClient.sendBotMessage(
        room.id,
        {
          text: draft,
          clientRequestId: id,
          mentionBotId: selected && draft.includes(`@${selected.name} `) ? selected.id : undefined,
        },
        { idempotencyKey: id },
      )
    },
    onSuccess: () => {
      setDraft('')
      setSelected(undefined)
      requestId.current = undefined
      onSent()
      input.current?.focus()
    },
  })
  const change = (value: string) => {
    setDraft(value)
    setHideMentions(false)
    requestId.current = undefined
    if (send.isError) send.reset()
  }
  const insert = (candidate: BotConversation['members'][number]) => {
    change(stringWithMention(draft, candidate.name))
    setSelected(candidate)
    input.current?.focus()
  }
  const submit = () => {
    if (draft.trim() && !send.isPending) send.mutate()
  }
  if (readOnly) return <p className="dsh-readonly-note">浏览者只读</p>
  return (
    <form
      className="dsh-composer"
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      {mention !== undefined && (
        <div className="mention-results" role="group" aria-label="引用资源候选">
          {candidates.length === 0 && <p className="mention-choice small muted">没有匹配的引用</p>}
          {candidates.map((candidate) => (
            <Button
              key={candidate.id}
              type="button"
              variant="ghost"
              className="mention-choice"
              onClick={() => insert(candidate)}
            >
              @{candidate.name}
            </Button>
          ))}
        </div>
      )}
      <Textarea
        ref={input}
        rows={1}
        className="dsh-composer-input min-h-0 resize-none border-0 bg-transparent p-0 shadow-none focus-visible:ring-0"
        maxLength={16000}
        aria-label="协作消息"
        placeholder={`发消息给 ${room.name}，输入 @ 引用`}
        value={draft}
        readOnly={send.isPending}
        onChange={(event) => change(event.target.value)}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return
          if (event.key === 'Escape' && mention !== undefined) {
            setHideMentions(true)
            event.stopPropagation()
          }
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            const candidate = candidates[0]
            if (candidate) insert(candidate)
            else submit()
          }
        }}
      />
      {send.isError && (
        <p className="field-error" role="alert">
          {describeRequestError(send.error).description}
        </p>
      )}
      <div className="dsh-composer-bar">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="dsh-icon-btn composer-add"
          aria-label="插入引用"
          disabled={send.isPending}
          onClick={() => {
            if (mention === undefined) change(`${draft}${draft && !draft.endsWith(' ') ? ' ' : ''}@`)
            input.current?.focus()
          }}
        >
          <Plus className="icon fill-none stroke-current stroke-2" aria-hidden="true" />
        </Button>
        <span className="spacer" />
        <Button
          type="submit"
          className="dsh-send"
          size="icon"
          aria-label="发送消息"
          disabled={!draft.trim() || send.isPending}
        >
          <Send className="icon fill-none stroke-current stroke-2" aria-hidden="true" />
        </Button>
      </div>
    </form>
  )
}
