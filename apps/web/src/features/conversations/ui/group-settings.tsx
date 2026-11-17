import { useEffect, useRef, useState } from 'react'
import { createIdempotencyKey } from '@dev-ops/api-client'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { BotAvatar } from '@/features/bots/ui/bot-avatar'
import { taskQueries } from '@/features/bot-tasks/api/queries'
import { apiClient } from '@/shared/api/client'
import { describeRequestError } from '@/shared/api/errors'
import { Button } from '@/shared/ui/controls/button'
import { Input } from '@/shared/ui/controls/input'
import { Select } from '@/shared/ui/controls/select'
import { WorkTagEditor } from '@/features/work-tags/ui/work-tag-editor'
import { Textarea } from '@/shared/ui/controls/textarea'
import { useGroupMemberChoices } from '../api/group-members'
import { ConversationAvatar } from './conversation-avatar'
import { ConversationIcon } from './conversation-icon'
import { conversationOptions, conversationsQueryKey, type BotConversation } from '../api/queries'

type Membership = { action: 'add' | 'remove'; memberId: string; kind: 'user' | 'bot' }

/** 显示原型群组设置栏，保存群组属性或独立维护成员。 */
export function GroupSettings({
  room,
  userId,
  onClose,
}: {
  room: BotConversation
  userId: string
  onClose: () => void
}) {
  const client = useQueryClient()
  const close = useRef<HTMLButtonElement>(null)
  const [editing, setEditing] = useState(false)
  const [managing, setManaging] = useState(false)
  const [name, setName] = useState(room.name)
  const [leader, setLeader] = useState(room.leaderBotId ?? '')
  const [responsibility, setResponsibility] = useState(room.responsibility)
  const [instructions, setInstructions] = useState(room.instructions)
  const [memberId, setMemberId] = useState('')
  const choices = useGroupMemberChoices(room.teamId)
  const bots = room.members.filter(({ kind }) => kind === 'bot')
  const leaderBot = bots.find(({ id }) => id === room.leaderBotId)
  const orderedBots = leaderBot ? [leaderBot, ...bots.filter(({ id }) => id !== leaderBot.id)] : bots
  const members = new Set(room.members.map((member) => member.id))
  const available = [
    ...choices.users.map((member) => ({ id: member.userId, label: member.name, kind: 'user' as const })),
    ...choices.bots.map((bot) => ({ id: bot.id, label: bot.name, kind: 'bot' as const })),
  ].filter(({ id }) => !members.has(id))
  const selected = available.find(({ id }) => id === memberId)
  const save = useMutation({
    mutationFn: () =>
      apiClient.updateBotConversation(
        room.id,
        {
          name: name.trim(),
          responsibility: responsibility.trim(),
          instructions: instructions.trim(),
          leaderBotId: leader,
        },
        { idempotencyKey: createIdempotencyKey() },
      ),
    onSuccess: (result) => {
      client.setQueryData(conversationOptions(room.id).queryKey, result)
      void client.invalidateQueries({ queryKey: conversationsQueryKey })
      onClose()
    },
  })
  const membership = useMutation({
    mutationFn: (change: Membership) =>
      apiClient.updateBotConversationMember(
        room.id,
        change.action,
        { memberId: change.memberId, kind: change.kind },
        { idempotencyKey: createIdempotencyKey() },
      ),
    onSuccess: (result) => {
      client.setQueryData(conversationOptions(room.id).queryKey, result)
      void client.invalidateQueries({ queryKey: taskQueries })
      void client.invalidateQueries({ queryKey: conversationsQueryKey })
      setMemberId('')
    },
  })
  useEffect(() => {
    close.current?.focus()
  }, [])
  return (
    <aside className="chat-settings-panel work-task-panel" aria-label="会话设置">
      <div className="row">
        <h3>会话设置</h3>
        <span className="spacer" />
        <Button
          unstyled
          type="button"
          ref={close}
          variant="ghost"
          size="icon"
          className="icon-btn"
          aria-label="关闭会话设置"
          onClick={onClose}
        >
          <ConversationIcon name="close" />
        </Button>
      </div>
      <div className="settings-room-identity">
        <ConversationAvatar kind={room.kind} bots={orderedBots} />
        <strong>{room.name}</strong>
      </div>
      <section className="settings-section">
        <div className="row">
          <strong>职责与指令</strong>
          <span className="spacer" />
          <Button
            unstyled
            type="button"
            className="text-btn"
            aria-expanded={editing}
            onClick={() => setEditing(!editing)}
          >
            {editing ? '收起' : '编辑'}
          </Button>
        </div>
        {!editing && <p>{room.responsibility || '尚未设置职责'}</p>}
        {!editing && room.instructions && <p className="room-instructions">{room.instructions}</p>}
        {editing && (
          <form
            className="form-grid"
            onSubmit={(event) => {
              event.preventDefault()
              if (!save.isPending) save.mutate()
            }}
          >
            <label className="field full">
              <span>群组名称</span>
              <Input required maxLength={80} value={name} onChange={(event) => setName(event.target.value)} />
            </label>
            <label className="field full">
              <span>Leader</span>
              <Select value={leader} required onChange={(event) => setLeader(event.target.value)}>
                {room.members
                  .filter(({ kind }) => kind === 'bot')
                  .map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.name}
                    </option>
                  ))}
              </Select>
            </label>
            <label className="field full">
              <span>职责</span>
              <Textarea
                maxLength={2000}
                value={responsibility}
                onChange={(event) => setResponsibility(event.target.value)}
              />
            </label>
            <label className="field full">
              <span>指令</span>
              <Textarea
                maxLength={8000}
                value={instructions}
                onChange={(event) => setInstructions(event.target.value)}
              />
            </label>
            <div className="form-actions full">
              <Button type="submit" disabled={save.isPending || !name.trim() || !leader}>
                保存设置
              </Button>
            </div>
          </form>
        )}
      </section>
      <section className="settings-section">
        <div className="row">
          <strong>成员</strong>
          <span className="spacer" />
          <Button
            unstyled
            type="button"
            className="text-btn"
            aria-expanded={managing}
            onClick={() => setManaging(!managing)}
          >
            {managing ? '收起' : '管理'}
          </Button>
        </div>
        <ul>
          {room.members.map((member) => (
            <li className="settings-member" key={member.id}>
              {member.kind === 'bot' && (
                <BotAvatar botId={member.id} avatarKey={member.avatarKey ?? null} enabled={member.enabled} />
              )}
              <span>
                {member.name}
                <small>{member.kind === 'bot' ? member.responsibility || '智能体' : '成员'}</small>
              </span>
              {room.leaderBotId === member.id && <span className="team-tag">Leader</span>}
              {managing && member.id !== userId && member.id !== room.leaderBotId && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={membership.isPending}
                  onClick={() => membership.mutate({ action: 'remove', memberId: member.id, kind: member.kind })}
                >
                  移出
                </Button>
              )}
            </li>
          ))}
        </ul>
        {managing && choices.pending && <p className="small muted">加载候选成员…</p>}
        {managing &&
          (choices.error ? (
            <Button type="button" variant="ghost" onClick={choices.retry}>
              重试加载候选成员
            </Button>
          ) : (
            <div className="work-gap">
              <label className="field">
                <span>添加成员</span>
                <Select value={memberId} onChange={(event) => setMemberId(event.target.value)}>
                  <option value="">请选择成员</option>
                  {available.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.label}
                    </option>
                  ))}
                </Select>
              </label>
              <Button
                type="button"
                variant="outline"
                disabled={!selected || membership.isPending}
                onClick={() => {
                  if (selected) membership.mutate({ action: 'add', memberId: selected.id, kind: selected.kind })
                }}
              >
                添加
              </Button>
              {choices.more && (
                <Button type="button" variant="ghost" disabled={choices.loadingMore} onClick={choices.loadMore}>
                  加载更多智能体
                </Button>
              )}
            </div>
          ))}
      </section>
      <section className="settings-section">
        <WorkTagEditor
          teamId={room.teamId}
          tags={room.tags}
          target={{ targetKind: 'conversation', targetId: room.id }}
          readOnly={false}
          onChanged={() => {
            void client.invalidateQueries({ queryKey: conversationOptions(room.id).queryKey })
            void client.invalidateQueries({ queryKey: conversationsQueryKey })
          }}
        />
      </section>
      {(save.error || membership.error) && (
        <p className="field-error" role="alert">
          {describeRequestError(save.error ?? membership.error).description}
        </p>
      )}
    </aside>
  )
}
