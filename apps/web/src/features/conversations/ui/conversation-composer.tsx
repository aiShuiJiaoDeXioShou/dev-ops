import { useLayoutEffect, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/shared/api/client'
import { describeRequestError } from '@/shared/api/errors'
import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/ui/controls/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/shared/ui/controls/dropdown-menu'
import { Textarea } from '@/shared/ui/controls/textarea'
import type { BotConversation } from '../api/queries'
import { ConversationIcon } from './conversation-icon'

type Candidate = { id: string; kind: 'bot' | 'skill'; name: string; token: string }

function asSkillCandidate(skill: BotConversation['skillReferences'][number]): Candidate {
  return { id: skill.id, name: skill.name, token: skill.identifier, kind: 'skill' }
}

function mentionAt(text: string, caret: number) {
  const match = /(?:^|\s)@([^\s@]*)$/u.exec(text.slice(0, caret))
  return match ? { query: match[1] ?? '', start: match.index + match[0].indexOf('@') } : undefined
}

type StoredDraft = { text: string; requestId?: string }

function mentionsIn(text: string, candidates: Candidate[]) {
  const ordered = candidates.slice().sort((left, right) => right.token.length - left.token.length)
  return [...text.matchAll(/(?:^|\s)@(?=\S)/gu)].map((match) => {
    const value = text.slice(match.index + match[0].length)
    return ordered.find(
      ({ token }) => value.startsWith(token) && /^(?:$|[\s,，。！？;；、])/u.test(value.slice(token.length)),
    )
  })
}

/**
 * 显示原型输入区、引用菜单和同位置的发送／停止按钮。
 * @param props 当前会话、只读权限、运行停止标记和可补充的任务版本。
 * @returns 会话输入区。发送失败保留草稿，同一内容重试沿用请求标识。
 */
export function ConversationComposer({
  room,
  readOnly,
  runningId,
  isStopping,
  onStop,
  initialSkillId,
  task,
  onNewTask,
  onSent,
}: {
  room: BotConversation
  readOnly: boolean
  runningId?: string
  isStopping: boolean
  onStop: (runId: string) => void
  initialSkillId?: string
  task?: { id: string; title: string; version: number }
  onNewTask: (opener: HTMLElement | null) => void
  onSent: () => void
}) {
  const defaultBot = room.leaderBotId ?? room.members.find(({ kind }) => kind === 'bot')?.id
  const initialReference = room.skillReferences.find(
    ({ id, botIds }) => id === initialSkillId && !!defaultBot && botIds.includes(defaultBot),
  )
  const client = useQueryClient()
  const draftKey = ['bot-conversation-draft', room.teamId, room.id]
  const cachedDraft = client.getQueryData<StoredDraft>(draftKey)
  const [draft, setDraft] = useState(() => {
    const prefix = initialReference ? `@${initialReference.identifier} ` : ''
    const cached = cachedDraft?.text ?? ''
    return prefix && !cached.includes(prefix) ? prefix + cached : cached
  })
  const [caret, setCaret] = useState(draft.length)
  const [hideMentions, setHideMentions] = useState(false)
  const [candidateIndex, setCandidateIndex] = useState(0)
  const [supplementId, setSupplementId] = useState<string>()
  const input = useRef<HTMLTextAreaElement>(null)
  const nextCaret = useRef<number | null>(null)
  const addTrigger = useRef<HTMLButtonElement>(null)
  const requestId = useRef(cachedDraft?.text === draft ? cachedDraft?.requestId : undefined)
  const menuOpenedMention = useRef(false)
  const supplement = task && task.id === supplementId ? task : undefined
  const mention = supplement || hideMentions ? undefined : mentionAt(draft, caret)
  const botCandidates: Candidate[] = room.members
    .filter(({ kind, enabled }) => kind === 'bot' && enabled !== false)
    .map(({ id, name }) => ({ id, kind: 'bot', name, token: name }))
  const mentioned = supplement
    ? []
    : mentionsIn(draft, [...botCandidates, ...room.skillReferences.map(asSkillCandidate)])
  const selectedBotId = mentioned.find((item) => item?.kind === 'bot')?.id
  const targetBot = selectedBotId ?? defaultBot
  const skillCandidates = room.skillReferences
    .filter(({ botIds }) => !!targetBot && botIds.includes(targetBot))
    .map(asSkillCandidate)
  const candidates = mention
    ? [...botCandidates, ...skillCandidates]
        .filter(({ name, token }) => `${name} ${token}`.toLowerCase().includes(mention.query.toLowerCase()))
        .slice(0, 12)
    : []
  const activeCandidate = candidates[Math.min(candidateIndex, candidates.length - 1)]
  const activeSkillIds = [...new Set(mentioned.flatMap((item) => (item?.kind === 'skill' ? [item.id] : [])))]
  const hasUnknownReference = mentioned.some((item) => !item)
  const [referenceError, setReferenceError] = useState(false)
  const send = useMutation({
    mutationFn: async () => {
      const id = requestId.current ?? crypto.randomUUID()
      requestId.current = id
      client.setQueryData<StoredDraft>(draftKey, { text: draft, requestId: id })
      if (supplement) {
        await apiClient.appendBotTask(
          supplement.id,
          { version: supplement.version, content: draft },
          { idempotencyKey: id },
        )
        return
      }
      await apiClient.sendBotMessage(
        room.id,
        {
          text: draft,
          clientRequestId: id,
          mentionBotId: selectedBotId,
          ...(activeSkillIds.length ? { skillIds: activeSkillIds } : {}),
        },
        { idempotencyKey: id },
      )
    },
    onSuccess: () => {
      setDraft('')
      setCaret(0)
      client.setQueryData<StoredDraft>(draftKey, { text: '' })
      setSupplementId(undefined)
      requestId.current = undefined
      onSent()
      input.current?.focus()
    },
  })
  useLayoutEffect(() => {
    const position = nextCaret.current
    if (position === null) return
    input.current?.setSelectionRange(position, position)
    nextCaret.current = null
  }, [draft])

  const change = (value: string, position: number) => {
    setDraft(value)
    client.setQueryData<StoredDraft>(draftKey, { text: value })
    setReferenceError(false)
    setCaret(position)
    setHideMentions(false)
    setCandidateIndex(0)
    requestId.current = undefined
    if (send.isError) send.reset()
  }
  const replace = (value: string, position: number) => {
    nextCaret.current = position
    change(value, position)
    input.current?.focus()
  }
  const insert = (candidate: Candidate) => {
    if (!mention) return
    const start = `${draft.slice(0, mention.start)}@${candidate.token} `
    replace(start + draft.slice(caret), start.length)
  }
  const submit = () => {
    if (mention && activeCandidate) {
      insert(activeCandidate)
      return
    }
    if (mention || !draft.trim() || send.isPending) return
    if (hasUnknownReference) {
      setReferenceError(true)
      return
    }
    send.mutate()
  }
  if (readOnly) return <p className="dsh-readonly-note">浏览者只读</p>
  return (
    <form
      className={cn('dsh-composer', runningId && 'is-generating')}
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      {mention && (
        <div className="mention-results" role="group" aria-label="引用资源候选">
          {candidates.length === 0 && (
            <p className="mention-choice small muted" role="status">
              没有匹配的引用
            </p>
          )}
          {candidates.map((candidate) => (
            <Button
              unstyled
              key={candidate.id}
              type="button"
              variant="ghost"
              className={cn('mention-choice', candidate === activeCandidate && 'is-highlighted')}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => insert(candidate)}
            >
              @{candidate.token}
              <small>{candidate.kind === 'bot' ? 'Bot' : `技能 · ${candidate.name}`}</small>
            </Button>
          ))}
        </div>
      )}
      {task && (
        <div className="composer-task-mode">
          <Button
            unstyled
            type="button"
            variant="ghost"
            className="text-btn"
            disabled={send.isPending}
            onClick={() => {
              setSupplementId(supplement ? undefined : task.id)
              requestId.current = undefined
              input.current?.focus()
            }}
          >
            {supplement ? '正在补充任务 · 取消' : '补充当前任务'}
          </Button>
        </div>
      )}
      <Textarea
        ref={input}
        rows={1}
        className="dsh-composer-input min-h-7 resize-none! rounded-none border-0 bg-transparent p-0 shadow-none focus-visible:ring-0"
        maxLength={16000}
        aria-label="协作消息"
        placeholder={supplement ? `补充任务「${supplement.title}」` : `发消息给 ${room.name}，输入 @ 引用资源`}
        value={draft}
        readOnly={send.isPending}
        onChange={(event) => change(event.target.value, event.target.selectionStart)}
        onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || event.keyCode === 229) return
          if (event.key === 'Escape' && mention) {
            event.preventDefault()
            event.stopPropagation()
            setHideMentions(true)
          }
          if (mention && candidates.length && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
            event.preventDefault()
            const current = Math.min(candidateIndex, candidates.length - 1)
            setCandidateIndex((current + (event.key === 'ArrowDown' ? 1 : candidates.length - 1)) % candidates.length)
          }
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            submit()
          }
        }}
      />
      {initialSkillId && !initialReference && (
        <p className="dsh-composer-notice">所选会话的默认智能体无法调用这项技能。</p>
      )}
      {referenceError && (
        <p className="field-error" role="alert">
          引用不存在或已停用，请从 @ 候选中重新选择。
        </p>
      )}
      {send.isError && (
        <p className="field-error" role="alert">
          {describeRequestError(send.error).description}
        </p>
      )}
      <div className="dsh-composer-bar">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              unstyled
              type="button"
              variant="ghost"
              size="icon"
              className="dsh-icon-btn composer-add"
              ref={addTrigger}
              aria-label="消息操作"
              disabled={send.isPending}
            >
              <ConversationIcon name="plus" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            side="top"
            onCloseAutoFocus={(event) => {
              if (!menuOpenedMention.current) return
              event.preventDefault()
              menuOpenedMention.current = false
              input.current?.focus()
            }}
          >
            <DropdownMenuItem onSelect={() => onNewTask(addTrigger.current)}>
              <ConversationIcon name="file" />
              新建任务
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={!!supplement}
              onSelect={() => {
                menuOpenedMention.current = true
                if (mention) return
                const before = draft.slice(0, caret)
                const prefix = `${before}${before && !/\s$/u.test(before) ? ' ' : ''}@`
                replace(prefix + draft.slice(caret), prefix.length)
              }}
            >
              <ConversationIcon name="chat" />
              插入引用
            </DropdownMenuItem>
            {runningId && draft.trim() && (
              <DropdownMenuItem disabled={!!mention} onSelect={submit}>
                <ConversationIcon name="send" />
                {supplement ? '保存补充' : '发送排队消息'}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        <span className={cn('dsh-composer-hint', room.kind === 'group' && 'is-required')}>
          {supplement
            ? '任务补充'
            : room.kind === 'group'
              ? '智能体读取团队资料后，结果对会话全体成员可见。'
              : 'Enter 发送 · Shift+Enter 换行'}
        </span>
        <span className="spacer" />
        {runningId ? (
          <Button
            unstyled
            type="button"
            className="dsh-send dsh-stop"
            size="icon"
            aria-label={isStopping ? '正在停止' : '停止生成'}
            disabled={isStopping}
            onClick={() => onStop(runningId)}
          >
            <span className="dsh-send-ring" aria-hidden="true" />
            <ConversationIcon name="stop" />
          </Button>
        ) : (
          <Button
            unstyled
            type="submit"
            className="dsh-send"
            size="icon"
            aria-label={supplement ? '保存补充' : '发送消息'}
            disabled={!draft.trim() || send.isPending || (!!mention && !activeCandidate)}
          >
            <ConversationIcon name="send" />
          </Button>
        )}
      </div>
    </form>
  )
}
