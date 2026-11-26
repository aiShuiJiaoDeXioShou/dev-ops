import { useLayoutEffect, useRef, useState } from 'react'
import { Paperclip } from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAttachmentPolicy } from '@/features/attachments/api/queries'
import { describeAttachmentError } from '@/features/attachments/lib/errors'
import { doneAttachmentIds, hasUnfinishedAttachments } from '@/features/attachments/lib/pending'
import type { PendingAttachment } from '@/features/attachments/model/types'
import { AttachmentField } from '@/features/attachments/ui/attachment-field'
import { apiClient } from '@/shared/api/client'
import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/ui/controls/button'
import { Textarea } from '@/shared/ui/controls/textarea'
import type { BotConversation } from '../api/queries'
import { ConversationCommands, commandCandidates } from './conversation-commands'
import { ConversationIcon } from './conversation-icon'
import './conversation-content.css'

type Candidate = { id: string; kind: 'bot' | 'skill' | 'all' | 'template' | 'command'; name: string; token: string }

function asSkillCandidate(skill: BotConversation['skillReferences'][number]): Candidate {
  return { id: skill.id, name: skill.name, token: `skill:${skill.identifier}`, kind: 'skill' }
}

function mentionAt(text: string, caret: number) {
  const prefix = text.slice(0, caret)
  const command = /^\/([^\s/]*)$/u.exec(prefix)
  if (command) return { query: command[1] ?? '', start: 0, symbol: '/' }
  const match = /(?:^|\s)@([^\s@]*)$/u.exec(prefix)
  return match ? { query: match[1] ?? '', start: match.index + match[0].indexOf('@'), symbol: '@' } : undefined
}

type StoredDraft = { text: string; requestId?: string; attachments?: PendingAttachment[] }

function mentionsIn(text: string, candidates: Candidate[]) {
  const ordered = candidates.slice().sort((left, right) => right.token.length - left.token.length)
  return [...text.matchAll(/(?:^|\s)@(?=\S)/gu)].map((match) => {
    const value = text.slice(match.index + match[0].length)
    return ordered.find(
      ({ token }) => value.startsWith(token) && /^(?:$|[\s,.!?;:，。！？；：、])/u.test(value.slice(token.length)),
    )
  })
}

/**
 * 显示支持附件、引用菜单和发送／停止操作的会话输入区。
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
  onSent,
}: {
  room: BotConversation
  readOnly: boolean
  runningId?: string
  isStopping: boolean
  onStop: (runId: string) => void
  initialSkillId?: string
  onSent: () => void
}) {
  const defaultBot = room.leaderBotId ?? room.members.find(({ kind }) => kind === 'bot')?.id
  const initialReference = room.skillReferences.find(
    ({ id, botIds }) => id === initialSkillId && !!defaultBot && botIds.includes(defaultBot),
  )
  const client = useQueryClient()
  const draftKey = ['bot-conversation-draft', room.teamId, room.id]
  const cachedDraft = client.getQueryData<StoredDraft>(draftKey)
  const queued = useQuery({
    queryKey: ['bot-queued-inputs', room.id],
    queryFn: () => apiClient.listBotQueuedInputs(room.id),
    enabled: !readOnly,
    refetchInterval: 1000,
  })
  const [draft, setDraft] = useState(() => {
    const prefix = initialReference ? `/skill:${initialReference.identifier} ` : ''
    const cached = cachedDraft?.text ?? ''
    return prefix && !cached.includes(prefix) ? prefix + cached : cached
  })
  const [attachments, setAttachments] = useState(() => cachedDraft?.attachments ?? [])
  const picker = useRef<HTMLInputElement>(null)
  const addFiles = useRef<((files: File[]) => void) | null>(null)
  const attachmentPolicy = useAttachmentPolicy(!readOnly)
  const [caret, setCaret] = useState(draft.length)
  const [hideMentions, setHideMentions] = useState(false)
  const [command, setCommand] = useState<string>()
  const [candidateIndex, setCandidateIndex] = useState(0)
  const input = useRef<HTMLTextAreaElement>(null)
  const readOnlyOpener = useRef<HTMLButtonElement | null>(null)
  const nextCaret = useRef<number | null>(null)
  const requestId = useRef(cachedDraft?.text === draft ? cachedDraft?.requestId : undefined)
  const attachmentIds = doneAttachmentIds(attachments)
  const hasDraftContent = !!draft.trim() || attachments.length > 0
  const mention = hideMentions ? undefined : mentionAt(draft, caret)
  const botCandidates: Candidate[] = room.members
    .filter(({ kind, enabled }) => kind === 'bot' && enabled !== false)
    .map(({ id, name }) => ({ id, kind: 'bot', name, token: name }))
  const all: Candidate = { id: 'all', kind: 'all', name: '所有智能体', token: '全部' }
  const templateName = draft.match(/^\/([a-z0-9-]+)/u)?.[1]
  const templates = useQuery({
    queryKey: ['bot-prompt-templates', room.teamId, templateName ?? ''],
    queryFn: ({ signal }) => apiClient.listBotPromptTemplates(room.teamId, { query: templateName }, { signal }),
    enabled: !readOnly && draft.startsWith('/'),
  })
  const templateCandidates: Candidate[] = (templates.data?.data.items ?? []).map(({ id, name, description }) => ({
    id,
    kind: 'template',
    token: name,
    name: description,
  }))
  const chosenTemplate = templateCandidates.find(({ token }) => token === templateName)
  const mentioned = mentionsIn(draft, [...botCandidates, all])
  const selectedBots = [...new Set(mentioned.flatMap((item) => (item?.kind === 'bot' ? [item.id] : [])))]
  const mentionAll = room.kind === 'group' && mentioned.some((item) => item?.kind === 'all')
  const targetBot = selectedBots[0] ?? defaultBot
  const skillCandidates = room.skillReferences
    .filter(({ botIds }) => !!targetBot && botIds.includes(targetBot))
    .map(asSkillCandidate)
  const candidates = mention
    ? (mention.symbol === '/'
        ? [...commandCandidates, ...templateCandidates, ...skillCandidates]
        : [...(room.kind === 'group' ? [all] : []), ...botCandidates]
      )
        .filter(({ name, token }) => `${name} ${token}`.toLowerCase().includes(mention.query.toLowerCase()))
        .slice(0, 12)
    : []
  const activeCandidate = candidates[Math.min(candidateIndex, candidates.length - 1)]
  const activeSkillIds = skillCandidates
    .filter(({ token }) => draft.split(/\s+/u).includes(`/${token}`))
    .map(({ id }) => id)
  const hasUnknownReference = mentioned.some((item) => !item)
  const [referenceError, setReferenceError] = useState(false)
  const send = useMutation({
    mutationFn: async (mode: 'steer' | 'auto') => {
      const id = requestId.current ?? crypto.randomUUID()
      requestId.current = id
      client.setQueryData<StoredDraft>(draftKey, {
        text: draft,
        requestId: id,
        attachments: attachments.filter(({ status }) => status === 'done'),
      })
      await apiClient.sendBotMessage(
        room.id,
        {
          text: draft,
          clientRequestId: id,
          ...(attachmentIds.length ? { attachmentIds } : {}),
          ...(selectedBots.length && !mentionAll ? { mentionBotIds: selectedBots } : {}),
          ...(mentionAll ? { mentionAll: true } : {}),
          ...(runningId ? { deliveryMode: mode } : {}),
          ...(chosenTemplate ? { promptTemplateId: chosenTemplate.id } : {}),
          ...(activeSkillIds.length ? { skillIds: activeSkillIds } : {}),
        },
        { idempotencyKey: id },
      )
    },
    onSuccess: () => {
      setDraft('')
      setCaret(0)
      setAttachments([])
      client.setQueryData<StoredDraft>(draftKey, () => ({
        text: '',
        attachments: [],
      }))
      requestId.current = undefined
      void queued.refetch()
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
    client.setQueryData<StoredDraft>(draftKey, (current) => ({ text: value, attachments: current?.attachments }))
    setReferenceError(false)
    setCaret(position)
    setHideMentions(false)
    setCandidateIndex(0)
    requestId.current = undefined
    if (send.isError) send.reset()
  }
  const changeAttachments = (next: PendingAttachment[]) => {
    setAttachments(next)
    client.setQueryData<StoredDraft>(draftKey, (current) => ({
      text: current?.text ?? draft,
      attachments: next.filter(({ status }) => status === 'done'),
    }))
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
    if (candidate.kind === 'command') {
      setCommand(candidate.token)
      replace('', 0)
      return
    }
    const start = `${draft.slice(0, mention.start)}${mention.symbol}${candidate.token} `
    replace(start + draft.slice(caret), start.length)
  }
  const withdraw = useMutation({
    mutationFn: (messageId: string) =>
      apiClient.withdrawBotQueuedInput(room.id, messageId, { idempotencyKey: crypto.randomUUID() }),
    onSuccess: async ({ data }) => {
      replace([draft, data.text].filter(Boolean).join('\n'), [draft, data.text].filter(Boolean).join('\n').length)
      if (data.attachments.length)
        changeAttachments([
          ...attachments,
          ...data.attachments.map((item): PendingAttachment => ({
            clientId: crypto.randomUUID(),
            attachmentId: item.id,
            fileName: item.fileName,
            sizeBytes: item.sizeBytes,
            status: 'done',
            progress: 100,
          })),
        ])
      await queued.refetch()
      onSent()
    },
  })
  const cannotSend =
    !hasDraftContent ||
    send.isPending ||
    withdraw.isPending ||
    hasUnfinishedAttachments(attachments) ||
    (draft.startsWith('/') && templates.isPending)
  const submit = (mode: 'steer' | 'auto' = 'steer') => {
    if (mention && activeCandidate) {
      insert(activeCandidate)
      return
    }
    if (cannotSend) return
    if (hasUnknownReference) {
      setReferenceError(true)
      return
    }
    send.mutate(mode)
  }
  if (readOnly)
    return (
      <div className="dsh-readonly-note">
        浏览者只读{' '}
        <Button
          variant="ghost"
          size="sm"
          onClick={(event) => {
            readOnlyOpener.current = event.currentTarget
            setCommand('copy')
          }}
        >
          /copy
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={(event) => {
            readOnlyOpener.current = event.currentTarget
            setCommand('session')
          }}
        >
          /session
        </Button>
        <ConversationCommands
          room={room}
          command={command}
          onClose={() => {
            setCommand(undefined)
            readOnlyOpener.current?.focus()
          }}
          busy={!!runningId}
        />
      </div>
    )
  return (
    <>
      <form
        className={cn('dsh-composer conversation-composer', runningId && 'is-generating')}
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes('Files')) event.preventDefault()
        }}
        onDrop={(event) => {
          if (!send.isPending && event.dataTransfer.files.length) {
            event.preventDefault()
            addFiles.current?.(Array.from(event.dataTransfer.files))
          }
        }}
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        {queued.data?.data.items.map((item) => (
          <div className="row small gap-2" key={item.messageId}>
            <span className="min-w-0 truncate">
              {item.mode === 'steer' ? '插话' : '追加'}：{item.text}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={withdraw.isPending || send.isPending}
              onClick={() => withdraw.mutate(item.messageId)}
            >
              撤回到输入框
            </Button>
          </div>
        ))}
        {withdraw.isError && (
          <p role="alert" className="field-error">
            {describeAttachmentError(withdraw.error)}
          </p>
        )}
        {queued.isError && (
          <Button type="button" variant="ghost" onClick={() => void queued.refetch()}>
            队列加载失败，重试
          </Button>
        )}
        {mention && (
          <div
            className="mention-results"
            role="group"
            aria-label={mention.symbol === '/' ? '会话命令候选' : 'Bot 候选'}
          >
            {mention.symbol === '/' && templates.isError && (
              <Button type="button" variant="ghost" size="sm" onClick={() => void templates.refetch()}>
                模板加载失败，重试
              </Button>
            )}
            {candidates.length === 0 && !(mention.symbol === '/' && templates.isError) && (
              <p className="mention-choice small muted" role="status">
                {mention.symbol === '/' && templates.isPending
                  ? '正在加载提示模板…'
                  : mention.symbol === '/'
                    ? '没有匹配的命令'
                    : '没有匹配的 Bot'}
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
                {mention.symbol}
                {candidate.token}
                <small>
                  {candidate.kind === 'bot'
                    ? 'Bot'
                    : candidate.kind === 'skill'
                      ? `技能 · ${candidate.name}`
                      : candidate.name}
                </small>
              </Button>
            ))}
          </div>
        )}
        <div>
          <AttachmentField
            conversationId={room.id}
            label="待发送附件"
            value={attachments}
            onChange={changeAttachments}
            pickerRef={picker}
            addFilesRef={addFiles}
            isSubmitting={send.isPending}
          />
        </div>
        <Textarea
          ref={input}
          rows={2}
          className="dsh-composer-input min-h-15 resize-none! rounded-none border-0 bg-transparent p-0 text-base shadow-none focus-visible:ring-0"
          maxLength={16000}
          aria-label="协作消息"
          placeholder={`发消息给 ${room.name}，@ 选择 Bot 或 / 打开命令`}
          value={draft}
          onPaste={(event) => {
            if (send.isPending) return
            const clipboard = event.clipboardData
            const files = clipboard.files.length
              ? Array.from(clipboard.files)
              : Array.from(clipboard.items).flatMap((item) => {
                  const file = item.kind === 'file' ? item.getAsFile() : null
                  return file ? [file] : []
                })
            const images = files.filter(({ type }) => type.startsWith('image/'))
            if (!images.length) return
            // 仅含图片时接管粘贴；混合剪贴板仍由浏览器按光标位置插入普通文本。
            if (!event.clipboardData.getData('text/plain')) event.preventDefault()
            addFiles.current?.(images)
          }}
          readOnly={send.isPending || withdraw.isPending}
          onChange={(event) => change(event.target.value, event.target.selectionStart)}
          onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || event.keyCode === 229) return
            if ((event.altKey || event.ctrlKey) && event.key === 'ArrowUp' && !withdraw.isPending) {
              const latest = queued.data?.data.items.at(-1)
              if (latest) {
                event.preventDefault()
                withdraw.mutate(latest.messageId)
                return
              }
            }
            if (event.key === 'Escape' && mention) {
              event.preventDefault()
              event.stopPropagation()
              setHideMentions(true)
              return
            }
            if (event.key === 'Escape' && runningId && !isStopping) {
              event.preventDefault()
              onStop(runningId)
              return
            }
            if (mention && candidates.length && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
              event.preventDefault()
              const current = Math.min(candidateIndex, candidates.length - 1)
              setCandidateIndex((current + (event.key === 'ArrowDown' ? 1 : candidates.length - 1)) % candidates.length)
            }
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              submit(event.altKey || event.ctrlKey ? 'auto' : 'steer')
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
            {describeAttachmentError(send.error)}
          </p>
        )}
        <div className="dsh-composer-bar">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="上传附件"
            disabled={send.isPending || attachmentPolicy.isPending}
            onClick={() => {
              if (attachmentPolicy.isError) void attachmentPolicy.refetch()
              else picker.current?.click()
            }}
          >
            <Paperclip aria-hidden="true" />
          </Button>
          {room.kind === 'group' && (
            <span className="dsh-composer-hint is-required">智能体读取团队资料后，结果对会话全体成员可见。</span>
          )}
          <span className="spacer" />
          {runningId && (
            <Button
              unstyled
              type="button"
              className="dsh-send dsh-stop"
              size="icon"
              aria-label={isStopping ? '正在停止' : '停止生成'}
              disabled={isStopping}
              onClick={() => onStop(runningId)}
            >
              <ConversationIcon name="stop" />
            </Button>
          )}
          {(!runningId || hasDraftContent) && (
            <Button unstyled type="submit" className="dsh-send" size="icon" aria-label="发送消息" disabled={cannotSend}>
              <ConversationIcon name="send" />
            </Button>
          )}
        </div>
      </form>
      <ConversationCommands
        room={room}
        command={command}
        onClose={() => {
          setCommand(undefined)
          input.current?.focus()
        }}
        busy={!!runningId}
      />
    </>
  )
}
