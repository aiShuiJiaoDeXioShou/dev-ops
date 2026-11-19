import { useRef, useState } from 'react'
import { createIdempotencyKey } from '@dev-ops/api-client'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, GitFork, Pencil } from 'lucide-react'
import { useNavigate } from 'react-router'
import { apiClient } from '@/shared/api/client'
import { describeRequestError } from '@/shared/api/errors'
import { Button } from '@/shared/ui/controls/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/controls/dialog'
import { Textarea } from '@/shared/ui/controls/textarea'
import { conversationEventsOptions, conversationOptions, conversationsQueryKey, messagesOptions } from '../api/queries'
import type { MessageView } from './conversation-message.view'

/**
 * 提供已提交消息的分支导航、编辑重发和图标式分叉操作，可嵌入回答操作栏。
 * @param props 消息、所属会话和当前是否有运行。
 * @returns 消息操作入口、版本位置与确认对话框。
 */
export function ConversationMessageActions({
  message,
  conversationId,
  busy,
}: {
  message: MessageView
  conversationId: string
  busy: boolean
}) {
  const navigate = useNavigate()
  const client = useQueryClient()
  const opener = useRef<HTMLButtonElement>(null)
  const [mode, setMode] = useState<'edit' | 'fork'>()
  const [draft, setDraft] = useState(message.text)
  const resendKey = useRef<string | undefined>(undefined)
  const branch = message.branchSiblings
  const mutation = useMutation({
    async mutationFn(action: 'edit' | 'fork' | 'previous' | 'next') {
      if (action === 'fork') {
        const result = await apiClient.forkBotConversation(
          conversationId,
          { messageId: message.id },
          { idempotencyKey: createIdempotencyKey() },
        )
        return result.data.id
      }
      if (action === 'edit') {
        const id = resendKey.current ?? crypto.randomUUID()
        resendKey.current = id
        await apiClient.editBotMessage(
          conversationId,
          message.id,
          { text: draft, clientRequestId: id },
          { idempotencyKey: id },
        )
      } else {
        await apiClient.switchBotConversationBranch(
          conversationId,
          { messageId: message.id, direction: action },
          { idempotencyKey: createIdempotencyKey() },
        )
      }
      return null
    },
    async onSuccess(roomId) {
      setMode(undefined)
      await client.invalidateQueries({ queryKey: conversationsQueryKey })
      if (roomId) {
        void navigate(`/collaboration/${roomId}`)
        return
      }
      await Promise.all([
        client.invalidateQueries({ queryKey: messagesOptions(conversationId).queryKey }),
        client.invalidateQueries({ queryKey: conversationOptions(conversationId).queryKey }),
        client.resetQueries({ queryKey: conversationEventsOptions(client, conversationId).queryKey }),
      ])
    },
  })
  function open(action: 'edit' | 'fork') {
    mutation.reset()
    resendKey.current = undefined
    setDraft(message.text)
    setMode(action)
  }
  const error = mutation.isError ? describeRequestError(mutation.error).description : undefined
  return (
    <div className="contents">
      {branch && (
        <>
          <Button
            variant="ghost"
            size="icon"
            type="button"
            aria-label="上一个消息版本"
            disabled={busy || mutation.isPending || branch.index <= 1}
            onClick={() => mutation.mutate('previous')}
          >
            <ChevronLeft className="size-4" aria-hidden="true" />
          </Button>
          <span className="small quiet" aria-label="消息版本">
            {branch.index} / {branch.total}
          </span>
          <Button
            variant="ghost"
            size="icon"
            type="button"
            aria-label="下一个消息版本"
            disabled={busy || mutation.isPending || branch.index >= branch.total}
            onClick={() => mutation.mutate('next')}
          >
            <ChevronRight className="size-4" aria-hidden="true" />
          </Button>
        </>
      )}
      {message.canEdit && (
        <Button
          unstyled
          type="button"
          className="dsh-answer-action"
          aria-label="编辑并重新发送"
          title="编辑并重新发送"
          disabled={busy || mutation.isPending}
          onClick={(event) => {
            opener.current = event.currentTarget
            open('edit')
          }}
        >
          <Pencil className="size-4" aria-hidden="true" />
        </Button>
      )}
      <Button
        unstyled
        type="button"
        className="dsh-answer-action"
        aria-label="从这里分叉"
        title="从这里分叉"
        disabled={mutation.isPending}
        onClick={(event) => {
          opener.current = event.currentTarget
          open('fork')
        }}
      >
        <GitFork className="size-4" aria-hidden="true" />
      </Button>
      {!mode && error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      <Dialog
        open={mode !== undefined}
        onOpenChange={(open) => {
          if (!open && !mutation.isPending) setMode(undefined)
        }}
      >
        <DialogContent
          showCloseButton={!mutation.isPending}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            opener.current?.focus()
          }}
        >
          <DialogHeader>
            <DialogTitle>{mode === 'edit' ? '编辑并重新发送' : '从这里分叉'}</DialogTitle>
            <DialogDescription>
              {mode === 'edit'
                ? '重新发送会开启一个新版本，原消息仍可切换查看。'
                : '将这条消息及此前的会话内容复制到一个新会话。'}
            </DialogDescription>
          </DialogHeader>
          <form
            className="form-grid"
            onSubmit={(event) => {
              event.preventDefault()
              if (mode && !mutation.isPending) mutation.mutate(mode)
            }}
          >
            {mode === 'edit' && (
              <label className="field full">
                <span>消息文本</span>
                <Textarea
                  value={draft}
                  required
                  rows={5}
                  maxLength={16000}
                  disabled={mutation.isPending}
                  onChange={(event) => {
                    resendKey.current = undefined
                    setDraft(event.target.value)
                  }}
                />
              </label>
            )}
            {error && (
              <p className="field-error full" role="alert">
                {error}
              </p>
            )}
            <DialogFooter className="full">
              <Button type="button" variant="outline" disabled={mutation.isPending} onClick={() => setMode(undefined)}>
                取消
              </Button>
              <Button
                type="submit"
                aria-busy={mutation.isPending}
                disabled={mutation.isPending || (mode === 'edit' && !draft.trim())}
              >
                {mode === 'edit' ? '重新发送' : '创建分叉'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
