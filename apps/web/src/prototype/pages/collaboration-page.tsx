import { useEffect, useRef, useState } from 'react'
import { cn } from '@/shared/lib/utils'
import { BotAvatar, BotGroupAvatar } from '@/prototype/components/avatar'
import {
  ProtoButton,
  ProtoEmpty,
  ProtoField,
  ProtoIconButton,
  ProtoSearch,
  ProtoWorkPageHead,
} from '@/prototype/components/proto-controls'
import { ProtoChip } from '@/prototype/components/proto'
import { PrototypeDialog } from '@/prototype/components/prototype-dialog'
import { PrototypeIcon } from '@/prototype/icons/icon'
import { usePrototypeMenu } from '@/prototype/layout/prototype-shell'
import { usePrototype } from '@/prototype/data/store'
import {
  collaborationBots,
  collaborationRooms,
  collaborationTasks,
  defaultCollaborationRoomId,
  demoBotReplies,
  mentionCandidates,
  pendingTaskPhases,
  taskSources,
} from '@/prototype/data/collaboration'
import type {
  CollaborationBot,
  CollaborationMessage,
  CollaborationRoom,
  CollaborationTask,
  MentionCandidate,
  TaskPhase,
  TaskSource,
} from '@/prototype/data/collaboration'
import type { DemoProject } from '@/prototype/data/types'

/** 会话设置改为本地保存时使用的结构，避免直接改写演示种子数据。 */
interface RoomSettingsOverride {
  name: string
  leaderId: string
  memberIds: string[]
  topicTags: string[]
  projectIds: string[]
}

/** 新建任务表单提交的字段，由页面补全负责人、环境与交接记录。 */
interface NewTaskInput {
  title: string
  executorId: string
  source: TaskSource
}

/** 通知中心演示数据；只读本地状态，不发送外部消息。 */
const demoNotifications = [
  { id: 'notice-1', text: '发布计划待确认：统一错误响应结构', time: '今天 09:42', read: false },
  { id: 'notice-2', text: '变更计划已完成模拟核对：团队执行器 / 测试 / v0.9.4', time: '今天 09:05', read: false },
  { id: 'notice-3', text: '规则触发：API 登录异常巡检已聚合', time: '昨天 18:20', read: true },
]

/** 会话视图页签；与 HTML 原型的 dsh 页签保持一致。 */
const chatTabs = ['对话', '轨迹', '上下文', '编队'] as const
type ChatTab = (typeof chatTabs)[number]

/** 任务阶段到下一步动作的映射；已完成任务没有后续动作。 */
const taskAdvanceActions: Partial<Record<TaskPhase, { next: TaskPhase; label: string; note: string }>> = {
  待开始: { next: '进行中', label: '开始演示任务', note: '开始本地演示' },
  进行中: { next: '待验收', label: '提交任务结果', note: '提交任务结果，等待业务验收' },
  待验收: { next: '已完成', label: '验收结果', note: '业务负责人验收通过' },
  受阻: { next: '进行中', label: '重新开始', note: '恢复执行' },
}

/** 未命中会话回复池时使用的兜底文案，明确说明是本地模拟。 */
const fallbackBotReply = '收到，我已记录这条补充（本地模拟回复，未调用模型或执行器）。'

/**
 * 生成本地时间文案，用于新建任务和状态流转记录。
 * @returns 形如 `2026/11/10 10:24:05` 的中文时间字符串。
 */
function nowLabel() {
  return new Date().toLocaleString('zh-CN', { hour12: false })
}

/**
 * 合并本地保存的会话设置，只覆盖展示字段。
 * @param room 演示会话；override 本地设置，可为空。
 * @returns 应用本地设置后的会话对象；不修改原对象。
 */
function applyRoomOverride(room: CollaborationRoom, override?: RoomSettingsOverride): CollaborationRoom {
  return override ? { ...room, ...override } : room
}

/**
 * 计算任务当前阶段可执行的下一步动作。
 * @param phase 任务当前阶段。
 * @returns 下一步动作；已完成任务返回 undefined。
 */
function advanceActionFor(phase: TaskPhase) {
  return taskAdvanceActions[phase]
}

/**
 * 生成任务阶段对应的原型标签色调。
 * @param phase 任务阶段。
 * @returns `.work-chip` 色调；普通阶段返回 undefined。
 */
function phaseTone(phase: TaskPhase) {
  if (phase === '已完成') return 'success' as const
  if (phase === '受阻') return 'warning' as const
  return undefined
}

/**
 * 把最后一条消息压缩成会话列表摘要。
 * @param message 最后一条消息，可为空。
 * @returns 单行摘要；没有消息时返回占位文案。
 */
function messagePreview(message: CollaborationMessage | undefined) {
  if (!message) return '还没有消息'
  const text = message.text.replace(/\s+/g, ' ').trim()
  return text.slice(0, 72) || '还没有消息'
}

/**
 * 从消息时间文案中提取时:分，用于会话列表右侧时间。
 * @param message 最后一条消息，可为空。
 * @returns 形如 `09:42` 的时间文本；没有可识别时间时返回空字符串。
 */
function messageClock(message: CollaborationMessage | undefined) {
  return message?.time.match(/\d{1,2}:\d{2}/)?.[0] ?? ''
}

/**
 * 渲染会话头像：复用 Bot 头像资源，群组与直接会话共用 Leader 头像。
 * @param props.room 会话；props.bots 全部演示 Bot。
 * @returns 原型使用的 Bot 头像图片。
 */
function RoomAvatar({
  room,
  bots,
  size = 'md',
}: {
  room: CollaborationRoom
  bots: CollaborationBot[]
  size?: 'sm' | 'md' | 'lg'
}) {
  const leader = bots.find((bot) => bot.id === room.leaderId)
  if (room.kind === 'group' && room.memberIds.length > 1) {
    const members = room.memberIds
      .map((id) => bots.find((bot) => bot.id === id)?.name)
      .filter((name): name is string => Boolean(name))
    return <BotGroupAvatar names={members} />
  }
  return <BotAvatar name={leader?.name ?? room.name} size={size} />
}

/**
 * 渲染会话列表条目，包含头像、名称、未读、最后消息时间与摘要。
 * @param props 会话、最后消息、选中状态与切换回调。
 * @returns 原型 `.conversation-item` 结构的按钮。
 */
function ConversationItem({
  room,
  bots,
  lastMessage,
  active,
  unread,
  onSelect,
}: {
  room: CollaborationRoom
  bots: CollaborationBot[]
  lastMessage: CollaborationMessage | undefined
  active: boolean
  unread: number
  onSelect: () => void
}) {
  const clock = messageClock(lastMessage)
  return (
    <button
      type="button"
      className={cn('conversation-item', active && 'active')}
      aria-pressed={active}
      onClick={onSelect}
    >
      <span className="conversation-mark">
        <RoomAvatar room={room} bots={bots} size="lg" />
      </span>
      <span className="conversation-summary">
        <span className="conversation-title-row">
          <strong>{room.name}</strong>
          {unread > 0 && <span className="counter">{unread > 99 ? '99+' : unread}</span>}
          {clock && <time title={lastMessage?.time}>{clock}</time>}
        </span>
        <small>{messagePreview(lastMessage)}</small>
      </span>
    </button>
  )
}

/**
 * 渲染会话列表：搜索、新建任务、待你处理入口与全部会话。
 * @param props 会话数据、搜索词、待处理数量与各操作回调。
 * @returns 桌面与窄屏共用的 `.conversation-list` 侧栏。
 */
function ConversationList({
  rooms,
  bots,
  messagesByRoom,
  activeRoomId,
  unreadByRoom,
  query,
  onQueryChange,
  onSelect,
  inboxCount,
  inboxActive,
  onOpenInbox,
  onCreateTask,
  readOnly,
}: {
  rooms: CollaborationRoom[]
  bots: CollaborationBot[]
  messagesByRoom: Record<string, CollaborationMessage[]>
  activeRoomId: string
  unreadByRoom: Record<string, number>
  query: string
  onQueryChange: (query: string) => void
  onSelect: (roomId: string) => void
  inboxCount: number
  inboxActive: boolean
  onOpenInbox: () => void
  onCreateTask: () => void
  readOnly: boolean
}) {
  const { openMenu } = usePrototypeMenu()
  const [notifications, setNotifications] = useState(demoNotifications)
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const unreadNotifications = notifications.filter((item) => !item.read).length
  const keyword = query.trim().toLowerCase()
  const visibleRooms = rooms.filter((room) => {
    if (!keyword) return true
    const messages = messagesByRoom[room.id] ?? []
    const last = messages[messages.length - 1]
    return `${room.name} ${room.topicTags.join(' ')} ${last?.text ?? ''}`.toLowerCase().includes(keyword)
  })

  return (
    <aside className="conversation-list" aria-label="会话列表">
      <div className="row conv-tools">
        <ProtoIconButton label="展开导航" icon="menu" className="mobile-menu" onClick={openMenu} />
        <h2 className="sr-only">协作</h2>
        <ProtoSearch label="搜索会话" placeholder="搜索会话" value={query} onChange={onQueryChange} />
        <div className="create-wrap">
          <ProtoIconButton label="新建协作任务" icon="plus" disabled={readOnly} onClick={onCreateTask} />
        </div>
        <button
          type="button"
          className="icon-btn notice-btn"
          aria-label="通知中心"
          onClick={() => setNotificationsOpen(true)}
        >
          <PrototypeIcon name="bell" />
          {unreadNotifications > 0 && (
            <span className="notice-count" aria-hidden="true">
              {unreadNotifications}
            </span>
          )}
        </button>
      </div>
      <button type="button" className={cn('inbox-link', inboxActive && 'active')} onClick={onOpenInbox}>
        <PrototypeIcon name="inbox" />
        待你处理
        <span className="counter">{inboxCount}</span>
      </button>
      {visibleRooms.map((room) => {
        const messages = messagesByRoom[room.id] ?? []
        return (
          <ConversationItem
            key={room.id}
            room={room}
            bots={bots}
            lastMessage={messages[messages.length - 1]}
            active={room.id === activeRoomId && !inboxActive}
            unread={unreadByRoom[room.id] ?? 0}
            onSelect={() => onSelect(room.id)}
          />
        )
      })}
      {visibleRooms.length === 0 && (
        <ProtoEmpty icon="search" title="没有匹配的会话" description="调整搜索关键词后重试。" />
      )}
      <PrototypeDialog open={notificationsOpen} title="通知中心" onClose={() => setNotificationsOpen(false)}>
        <p className="small quiet">网页与飞书预览引用同一任务；没有发送外部消息。</p>
        {notifications.map((notice) => (
          <button
            key={notice.id}
            type="button"
            className="work-task-row"
            onClick={() => {
              setNotifications((current) =>
                current.map((item) => (item.id === notice.id ? { ...item, read: true } : item)),
              )
              setNotificationsOpen(false)
            }}
          >
            <span>
              <strong>{notice.text}</strong>
              <small>{notice.time}</small>
            </span>
            <ProtoChip>{notice.read ? '已读' : '未读'}</ProtoChip>
          </button>
        ))}
        {notifications.length === 0 && (
          <ProtoEmpty title="没有通知" description="模拟运行完成或规则触发后会在这里出现通知。" />
        )}
      </PrototypeDialog>
    </aside>
  )
}

/**
 * 渲染右侧任务面板：属性、说明、交接记录与阶段动作。
 * @param props.task 当前任务；props.executorName 执行者名称；props.projectName 目标项目名称。
 * @param props.readOnly 浏览者只读；props.onClose 关闭面板；props.onAdvance 推进到指定阶段。
 * @returns 原型 `.work-task-panel` 结构的任务面板。
 */
function TaskPanel({
  task,
  executorName,
  projectName,
  readOnly,
  onClose,
  onAdvance,
}: {
  task: CollaborationTask
  executorName: string
  projectName: string
  readOnly: boolean
  onClose: () => void
  onAdvance: (next: TaskPhase, note: string) => void
}) {
  const action = advanceActionFor(task.phase)
  return (
    <aside className="work-task-panel" aria-label="当前任务">
      <div className="row">
        <h3>当前任务</h3>
        <span className="spacer" />
        <ProtoIconButton label="关闭任务面板" icon="close" onClick={onClose} />
      </div>
      <div className="task-title">{task.title}</div>
      <ProtoChip tone={phaseTone(task.phase)}>{task.phase}</ProtoChip>
      <dl className="work-properties">
        <dt>目标项目</dt>
        <dd>{projectName}</dd>
        <dt>业务负责人</dt>
        <dd>{task.owner}</dd>
        <dt>执行者</dt>
        <dd>{executorName}</dd>
        <dt>目标环境</dt>
        <dd>{task.environment}</dd>
        <dt>来源</dt>
        <dd>{task.source}</dd>
        {task.issueId && (
          <>
            <dt>关联事项</dt>
            <dd>{task.issueId}</dd>
          </>
        )}
      </dl>
      <p className="task-note">{task.note}</p>
      <div className="task-actions">
        {action && (
          <ProtoButton variant="primary" disabled={readOnly} onClick={() => onAdvance(action.next, action.note)}>
            {action.label}
          </ProtoButton>
        )}
        {task.phase === '进行中' && (
          <ProtoButton disabled={readOnly} onClick={() => onAdvance('受阻', '标记为受阻，等待恢复')}>
            标记受阻
          </ProtoButton>
        )}
      </div>
      <h3 className="task-section-title">交接记录</h3>
      <ol className="task-timeline">
        {task.events
          .slice()
          .reverse()
          .map((event, index) => (
            <li key={`${event}-${index}`}>{event}</li>
          ))}
      </ol>
      <p className="small quiet">执行完成后仍需业务验收。</p>
    </aside>
  )
}

/**
 * 渲染新建协作任务对话框：填写目标、执行者与来源。
 * @param props.open 打开状态；props.onClose 关闭回调；props.room 当前会话。
 * @param props.readOnly 浏览者只读；props.onCreate 提交回调。
 * @returns 与原型 dialog 一致的本地任务表单。
 */
function NewTaskDialog({
  open,
  onClose,
  room,
  readOnly,
  onCreate,
}: {
  open: boolean
  onClose: () => void
  room: CollaborationRoom
  readOnly: boolean
  onCreate: (input: NewTaskInput) => void
}) {
  const memberBots = collaborationBots.filter((bot) => room.memberIds.includes(bot.id))
  const [title, setTitle] = useState('')
  const [executorId, setExecutorId] = useState(memberBots[0]?.id ?? '')
  const [source, setSource] = useState<TaskSource>('对话')
  const [error, setError] = useState('')

  const submit = () => {
    if (readOnly) return
    const trimmedTitle = title.trim()
    if (!trimmedTitle || !executorId) {
      setError('请填写任务目标并选择执行者。')
      return
    }
    onCreate({ title: trimmedTitle, executorId, source })
    setTitle('')
    setError('')
    onClose()
  }

  return (
    <PrototypeDialog open={open} title="新建协作任务" onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <div className="form-grid">
          <ProtoField label="目标" full>
            <input
              value={title}
              maxLength={80}
              placeholder="描述期望交付的结果"
              disabled={readOnly}
              onChange={(event) => setTitle(event.target.value)}
            />
          </ProtoField>
          <ProtoField label="执行者">
            <select
              aria-label="执行者"
              value={executorId}
              disabled={readOnly}
              onChange={(event) => setExecutorId(event.target.value)}
            >
              {memberBots.map((bot) => (
                <option key={bot.id} value={bot.id}>
                  {bot.name} · {bot.role}
                  {bot.online ? '' : '（离线）'}
                </option>
              ))}
            </select>
          </ProtoField>
          <ProtoField label="来源">
            <select
              aria-label="任务来源"
              value={source}
              disabled={readOnly}
              onChange={(event) => {
                const next = taskSources.find((item) => item === event.target.value)
                if (next) setSource(next)
              }}
            >
              {taskSources.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </ProtoField>
        </div>
        <p className="small muted">执行者离线时任务会标记为受阻；只写入本地演示状态，不调用执行器。</p>
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions">
          <ProtoButton onClick={onClose}>取消</ProtoButton>
          <ProtoButton variant="primary" type="submit" disabled={readOnly}>
            建立任务
          </ProtoButton>
        </div>
      </form>
    </PrototypeDialog>
  )
}

/**
 * 渲染会话设置侧栏：名称、Leader、参与 Bot、工作标签与项目引用。
 * @param props.room 当前会话；props.bots 全部演示 Bot；props.projects 当前团队项目。
 * @param props.readOnly 浏览者只读；props.onSave 保存本地设置；props.onClose 关闭面板。
 * @returns 与原型 `.chat-settings-panel` 一致的表单侧栏。
 */
function RoomSettingsPanel({
  room,
  bots,
  projects,
  readOnly,
  onSave,
  onClose,
}: {
  room: CollaborationRoom
  bots: CollaborationBot[]
  projects: DemoProject[]
  readOnly: boolean
  onSave: (settings: RoomSettingsOverride) => void
  onClose: () => void
}) {
  const [name, setName] = useState(room.name)
  const [leaderId, setLeaderId] = useState(room.leaderId)
  const [memberIds, setMemberIds] = useState(room.memberIds)
  const [tagText, setTagText] = useState(room.topicTags.join('、'))
  const [projectIds, setProjectIds] = useState(room.projectIds)
  const [error, setError] = useState('')
  const memberBots = bots.filter((bot) => memberIds.includes(bot.id))

  const toggleMember = (botId: string) => {
    const next = memberIds.includes(botId) ? memberIds.filter((id) => id !== botId) : [...memberIds, botId]
    setMemberIds(next)
    if (!next.includes(leaderId)) setLeaderId(next[0] ?? '')
  }

  const submit = () => {
    if (readOnly) return
    const trimmedName = name.trim()
    if (!trimmedName) {
      setError('请填写会话名称。')
      return
    }
    if (memberIds.length === 0) {
      setError('群组至少保留一位 Bot 成员。')
      return
    }
    const nextLeaderId = memberIds.includes(leaderId) ? leaderId : (memberIds[0] ?? '')
    const topicTags = tagText
      .split(/[、,，\s]+/)
      .map((tag) => tag.trim())
      .filter(Boolean)
    onSave({ name: trimmedName, leaderId: nextLeaderId, memberIds, topicTags, projectIds })
  }

  return (
    <aside className="chat-settings-panel" aria-label="会话设置">
      <div className="row">
        <h3>{room.kind === 'group' ? '群组设置' : '会话设置'}</h3>
        <span className="spacer" />
        <ProtoIconButton label="关闭会话设置" icon="close" onClick={onClose} />
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <div className="form-grid">
          <ProtoField label="名称" full>
            <input value={name} maxLength={60} disabled={readOnly} onChange={(event) => setName(event.target.value)} />
          </ProtoField>
          <ProtoField label="Leader" full>
            <select
              aria-label="Leader"
              value={leaderId}
              disabled={readOnly}
              onChange={(event) => setLeaderId(event.target.value)}
            >
              {memberBots.map((bot) => (
                <option key={bot.id} value={bot.id}>
                  {bot.name} · {bot.role}
                </option>
              ))}
            </select>
          </ProtoField>
          <div className="field full">
            <span>参与 Bot</span>
            <div className="work-checks">
              {bots.map((bot) => (
                <label key={bot.id}>
                  <input
                    type="checkbox"
                    checked={memberIds.includes(bot.id)}
                    disabled={readOnly}
                    onChange={() => toggleMember(bot.id)}
                  />
                  <BotAvatar name={bot.name} size="sm" />
                  {bot.name}
                </label>
              ))}
            </div>
            <span className="small quiet">成员独立于项目；移出执行者会让等待中的任务受阻。</span>
          </div>
          <ProtoField label="工作标签" full>
            <input
              value={tagText}
              placeholder="例如：研发协作、异常排查"
              disabled={readOnly}
              onChange={(event) => setTagText(event.target.value)}
            />
            <span className="small quiet">标签只用于本地归集与筛选，不改变项目工具授权。</span>
          </ProtoField>
          <div className="field full">
            <span>项目引用</span>
            <div className="context-projects">
              {projects.map((project) => (
                <label className="context-project" key={project.id}>
                  <input
                    type="checkbox"
                    checked={projectIds.includes(project.id)}
                    disabled={readOnly}
                    onChange={(event) => {
                      setProjectIds((current) =>
                        event.target.checked ? [...current, project.id] : current.filter((id) => id !== project.id),
                      )
                    }}
                  />
                  <span>
                    <strong>{project.name}</strong>
                    <small>
                      {project.provider} · {project.repo}
                    </small>
                  </span>
                </label>
              ))}
            </div>
            <span className="small quiet">引用项目不会自动授予项目工具权限，原型不校验真实权限。</span>
          </div>
        </div>
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions">
          <ProtoButton onClick={onClose}>取消</ProtoButton>
          <ProtoButton variant="primary" type="submit" disabled={readOnly}>
            保存设置
          </ProtoButton>
        </div>
      </form>
    </aside>
  )
}

/**
 * 渲染对话页签的消息流；没有消息时展示原型欢迎区。
 * @param props.messages 当前会话消息；props.room 当前会话；props.bots 全部演示 Bot。
 * @returns `.dsh-messages` 消息列表或 `.dsh-hero` 欢迎区。
 */
function MessageList({
  messages,
  room,
  bots,
}: {
  messages: CollaborationMessage[]
  room: CollaborationRoom
  bots: CollaborationBot[]
}) {
  if (messages.length === 0) {
    const leader = bots.find((bot) => bot.id === room.leaderId)
    return (
      <div className="dsh-hero">
        <span className="dsh-hero-avatar">
          <RoomAvatar room={room} bots={bots} size="lg" />
        </span>
        <h1>{room.name}</h1>
        <p>
          {leader?.role ?? '智能体'} · Leader {leader?.name ?? '未设置'}
        </p>
        <p className="dsh-hero-note">发送第一条消息后，回复由本地脚本模拟；轨迹和上下文收在顶部页签中。</p>
      </div>
    )
  }

  return (
    <div className="dsh-messages">
      {messages.map((message) =>
        message.from === 'user' ? (
          <article key={message.id} className="dsh-message dsh-user">
            <div className="dsh-user-bubble">{message.text}</div>
            <div className="dsh-user-meta">
              <span>{message.time}</span>
            </div>
          </article>
        ) : (
          <article key={message.id} className="dsh-message dsh-assistant dsh-plain-message">
            <div className="dsh-assistant-head">
              <BotAvatar name={message.author} size="sm" />
              <span className="dsh-author">{message.author}</span>
              {message.simulated && <span className="dsh-sim">本地模拟</span>}
              <time className="dsh-time">{message.time}</time>
            </div>
            <div className="dsh-plain-text">{message.text}</div>
          </article>
        ),
      )}
    </div>
  )
}

/**
 * 渲染轨迹页签：本地任务与工具活动记录，或原型空状态。
 * @param props.room 当前会话。
 * @returns `.dsh-tab-panel` 结构的活动列表。
 */
function ActivityPanel({ room }: { room: CollaborationRoom }) {
  if (room.activity.length === 0) {
    return (
      <div className="dsh-tab-panel">
        <div className="dsh-panel-scroll">
          <div className="dsh-empty">
            <span className="dsh-empty-icon">
              <PrototypeIcon name="layers" />
            </span>
            <h3>还没有执行轨迹</h3>
            <p>当前会话的任务与工具活动会记录在这里；原型不调用模型或执行器。</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="dsh-tab-panel">
      <div className="dsh-panel-scroll">
        <section className="dsh-subsection">
          <div className="dsh-panel-head">
            <div>
              <strong>任务与工具活动</strong>
              <span className="dsh-panel-meta">{room.activity.length} 条本地记录</span>
            </div>
          </div>
          <div className="tool-results">
            {room.activity.map((activity) => (
              <div className="tool-result-card" key={activity.id}>
                <span className="row">
                  <PrototypeIcon name="terminal" />
                  <strong>{activity.label}</strong>
                  <span className="spacer" />
                  <ProtoChip>{activity.time}</ProtoChip>
                </span>
                <span className="small muted">{activity.detail}</span>
              </div>
            ))}
          </div>
        </section>
        <p className="dsh-note">轨迹为本地演示记录，不调用模型或执行器。</p>
      </div>
    </div>
  )
}

/**
 * 渲染上下文页签：项目引用、工作标签与任务资源引用。
 * @param props.room 当前会话；props.tasks 当前会话任务；props.projects 当前团队项目。
 * @returns `.dsh-tab-panel` 结构的上下文列表。
 */
function ContextPanel({
  room,
  tasks,
  projects,
}: {
  room: CollaborationRoom
  tasks: CollaborationTask[]
  projects: DemoProject[]
}) {
  const contextProjects = projects.filter((project) => room.projectIds.includes(project.id))
  const references = [...new Set(tasks.flatMap((task) => task.references))]

  return (
    <div className="dsh-tab-panel">
      <div className="dsh-panel-scroll">
        <div className="ctx-wrap">
          {contextProjects.length > 0 && (
            <ul className="ctx-list">
              {contextProjects.map((project) => (
                <li className="ctx-row" key={project.id}>
                  <span className="ctx-icon">
                    <PrototypeIcon name="folder" />
                  </span>
                  <span className="ctx-main">
                    <span className="ctx-title">
                      <strong>{project.name}</strong>
                      <span className="ctx-kind">项目</span>
                    </span>
                    <small>
                      {project.provider} · {project.repo}
                    </small>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div className="ctx-section">
            <div className="ctx-section-head">
              <h3>工作标签</h3>
              <span className="ctx-count">{room.topicTags.length}</span>
            </div>
            <div className="ctx-refs">
              {room.topicTags.map((tag) => (
                <span className="ctx-ref" key={tag}>
                  <PrototypeIcon name="layers" />#{tag}
                </span>
              ))}
              {room.topicTags.length === 0 && <span className="ctx-ref">暂无标签</span>}
            </div>
          </div>
          <div className="ctx-section">
            <div className="ctx-section-head">
              <h3>任务资源引用</h3>
              <span className="ctx-count">{references.length}</span>
            </div>
            <div className="ctx-refs">
              {references.map((reference) => (
                <span className="ctx-ref" key={reference}>
                  <PrototypeIcon name="link" />
                  {reference}
                </span>
              ))}
              {references.length === 0 && <span className="ctx-ref">暂无引用</span>}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * 渲染编队页签：Bot 成员、Leader 标识与当前会话任务。
 * @param props.room 当前会话；props.bots 全部演示 Bot；props.tasks 当前会话任务。
 * @param props.projectNameFor 项目名称解析；props.executorNameFor 执行者名称解析。
 * @param props.readOnly 浏览者只读；props.onManageMembers 打开设置；props.onCreateTask 新建任务。
 * @param props.onOpenTask 打开任务面板。
 * @returns `.dsh-tab-panel` 结构的编队与任务列表。
 */
function TeamPanel({
  room,
  bots,
  tasks,
  projectNameFor,
  executorNameFor,
  readOnly,
  onManageMembers,
  onCreateTask,
  onOpenTask,
  onOpenTaskPanel,
}: {
  room: CollaborationRoom
  bots: CollaborationBot[]
  tasks: CollaborationTask[]
  projectNameFor: (projectId: string) => string
  executorNameFor: (executorId: string) => string
  readOnly: boolean
  onManageMembers: () => void
  onCreateTask: () => void
  onOpenTask: (task: CollaborationTask) => void
  onOpenTaskPanel: () => void
}) {
  const members = bots.filter((bot) => room.memberIds.includes(bot.id))
  const leader = bots.find((bot) => bot.id === room.leaderId)

  return (
    <div className="dsh-tab-panel">
      <div className="dsh-panel-scroll">
        <div className="team-panel">
          <div className="dsh-panel-head">
            <div>
              <strong>编队</strong>
              <span className="dsh-panel-meta">
                {members.length} 位 Bot · Leader {leader?.name ?? '未设置'}
              </span>
            </div>
            <div className="dsh-panel-actions">
              <ProtoButton onClick={onManageMembers}>管理成员</ProtoButton>
              <ProtoButton onClick={onManageMembers}>会话设置</ProtoButton>
            </div>
          </div>
          <ul className="team-members">
            {members.map((member) => (
              <li key={member.id} className={cn('team-member', member.id === room.leaderId && 'is-leader')}>
                <BotAvatar name={member.name} size="md" />
                <div className="team-main">
                  <div className="team-name">
                    <strong>{member.name}</strong>
                    {member.id === room.leaderId && <span className="team-tag">Leader</span>}
                    <span className={cn('dot', member.online && 'green')} title={member.online ? '可用' : '离线'} />
                  </div>
                  <span className="team-role">
                    {member.role} · {member.model} · {member.runtime}
                  </span>
                </div>
              </li>
            ))}
          </ul>
          <div className="ctx-section-head">
            <h3>协作任务</h3>
            <span className="ctx-count">{tasks.length}</span>
            <span className="spacer" />
            <div className="dsh-panel-actions">
              <ProtoButton disabled={readOnly} onClick={onCreateTask}>
                新建任务
              </ProtoButton>
              <ProtoButton onClick={onOpenTaskPanel}>全部任务</ProtoButton>
            </div>
          </div>
          {tasks.length > 0 ? (
            <div className="dsh-task-list">
              {tasks.map((task) => (
                <button type="button" className="work-task-row" key={task.id} onClick={() => onOpenTask(task)}>
                  <span>
                    <strong>{task.title}</strong>
                    <small>
                      {projectNameFor(task.projectId)} · 业务负责人 {task.owner} · 执行者{' '}
                      {executorNameFor(task.executorId)}
                    </small>
                  </span>
                  <ProtoChip tone={phaseTone(task.phase)}>{task.phase}</ProtoChip>
                </button>
              ))}
            </div>
          ) : (
            <p className="dsh-note">还没有协作任务；可在对话或加号菜单中显式创建。</p>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * 渲染协作原型页：会话列表、会话页签、输入区、任务面板与群组设置。
 * @returns 与 HTML 原型 `.collab-layout` 一致的三栏协作页面；浏览者只读。
 * @remarks 消息、模拟回复、任务与设置只写入页面本地状态，不调用模型或执行器。
 */
export function CollaborationPage() {
  const { data, currentRole, showToast } = usePrototype()
  const readOnly = currentRole === '浏览者'

  const [query, setQuery] = useState('')
  const [roomId, setRoomId] = useState(defaultCollaborationRoomId)
  const [messagesByRoom, setMessagesByRoom] = useState<Record<string, CollaborationMessage[]>>(() => {
    const map: Record<string, CollaborationMessage[]> = {}
    for (const room of collaborationRooms) map[room.id] = room.messages
    return map
  })
  const [unreadByRoom, setUnreadByRoom] = useState<Record<string, number>>(() => {
    const map: Record<string, number> = {}
    for (const room of collaborationRooms) map[room.id] = room.unreadCount
    return map
  })
  const [draft, setDraft] = useState('')
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const [chatTab, setChatTab] = useState<ChatTab>('对话')
  const [chatMenuOpen, setChatMenuOpen] = useState(false)
  const [tasks, setTasks] = useState<CollaborationTask[]>(collaborationTasks)
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(collaborationTasks[0]?.id ?? null)
  // 窄屏任务面板是覆盖层，默认收起；宽屏保留原型右侧常驻面板。
  const [panel, setPanel] = useState<'task' | null>(() =>
    typeof window !== 'undefined' && window.innerWidth > 1100 ? 'task' : null,
  )
  const [inboxActive, setInboxActive] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [newTaskOpen, setNewTaskOpen] = useState(false)
  const [mobileRoomsOpen, setMobileRoomsOpen] = useState(false)
  const [roomOverrides, setRoomOverrides] = useState<Record<string, RoomSettingsOverride>>({})
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const replyTimers = useRef<Array<ReturnType<typeof setTimeout>>>([])

  useEffect(
    () => () => {
      for (const timer of replyTimers.current) clearTimeout(timer)
    },
    [],
  )

  const rooms = collaborationRooms.map((room) => applyRoomOverride(room, roomOverrides[room.id]))
  const activeRoom = rooms.find((room) => room.id === roomId) ?? rooms[0]

  if (!activeRoom) {
    return (
      <div className="collab-layout">
        <ProtoEmpty
          icon="bot"
          title="没有可用的会话"
          description="原型数据缺少会话记录，请在设置中重置演示数据后重试。"
        />
      </div>
    )
  }

  const activeMessages = messagesByRoom[activeRoom.id] ?? []
  const roomTasks = tasks.filter((task) => task.roomId === activeRoom.id)
  const selectedTask = tasks.find((task) => task.id === selectedTaskId && task.roomId === activeRoom.id)
  const activeTask = selectedTask ?? roomTasks[0] ?? null
  const inboxTasks = tasks.filter((task) => pendingTaskPhases.includes(task.phase))
  const leader = collaborationBots.find((bot) => bot.id === activeRoom.leaderId)
  const tagsLabel = activeRoom.topicTags.map((tag) => `#${tag}`).join(' ')
  const roomMeta =
    activeRoom.kind === 'group'
      ? `${activeRoom.memberIds.length} 位 Bot · Leader ${leader?.name ?? '未设置'}`
      : (leader?.role ?? '智能体')
  const mentionOptions =
    mentionQuery === null
      ? []
      : mentionCandidates
          .filter((candidate) => {
            if (!mentionQuery) return true
            const keyword = mentionQuery.toLowerCase()
            return `${candidate.token} ${candidate.type} ${candidate.description}`.toLowerCase().includes(keyword)
          })
          .slice(0, 8)

  const badgeCounts: Record<ChatTab, number> = {
    对话: 0,
    轨迹: activeRoom.activity.length,
    上下文:
      activeRoom.projectIds.length + activeRoom.topicTags.length + roomTasks.flatMap((task) => task.references).length,
    编队: activeRoom.memberIds.length,
  }

  const projectNameFor = (projectId: string) =>
    data.projects.find((project) => project.id === projectId)?.name ?? '通用协作'
  const executorNameFor = (executorId: string) =>
    collaborationBots.find((bot) => bot.id === executorId)?.name ?? '未指定'

  const selectRoom = (nextRoomId: string) => {
    setRoomId(nextRoomId)
    setInboxActive(false)
    setSettingsOpen(false)
    setMobileRoomsOpen(false)
    setUnreadByRoom((current) => ({ ...current, [nextRoomId]: 0 }))
    const nextTask = tasks.find((task) => task.roomId === nextRoomId)
    setSelectedTaskId(nextTask?.id ?? null)
    if (!nextTask) setPanel(null)
  }

  const openInboxTask = (task: CollaborationTask) => {
    setRoomId(task.roomId)
    setUnreadByRoom((current) => ({ ...current, [task.roomId]: 0 }))
    setInboxActive(false)
    setSettingsOpen(false)
    setSelectedTaskId(task.id)
    setPanel('task')
  }

  const updateMentionQuery = (value: string, cursor: number | null) => {
    const position = cursor ?? value.length
    const match = /@([^\s@]*)$/.exec(value.slice(0, position))
    setMentionQuery(match ? (match[1] ?? '') : null)
  }

  const insertMention = (candidate: MentionCandidate) => {
    if (readOnly) return
    const textarea = textareaRef.current
    const cursor = textarea?.selectionStart ?? draft.length
    const before = draft.slice(0, cursor)
    const after = draft.slice(cursor)
    const replaced = /@[^\s@]*$/.test(before)
      ? before.replace(/@[^\s@]*$/, `${candidate.token} `)
      : `${before}${candidate.token} `
    setDraft(`${replaced}${after}`)
    setMentionQuery(null)
    setTimeout(() => {
      const target = textareaRef.current
      if (!target) return
      target.focus()
      target.setSelectionRange(replaced.length, replaced.length)
    }, 0)
  }

  const sendMessage = () => {
    if (readOnly) return
    const text = draft.trim()
    if (!text) return
    const message: CollaborationMessage = {
      id: `msg-user-${Date.now()}`,
      author: '林然',
      from: 'user',
      text,
      time: '刚刚',
    }
    setMessagesByRoom((current) => ({ ...current, [activeRoom.id]: [...(current[activeRoom.id] ?? []), message] }))
    setDraft('')
    setMentionQuery(null)

    const replyPool = demoBotReplies[activeRoom.id] ?? []
    const botCount = (messagesByRoom[activeRoom.id] ?? []).filter((item) => item.from === 'bot').length
    const replyText =
      replyPool.length > 0 ? (replyPool[botCount % replyPool.length] ?? fallbackBotReply) : fallbackBotReply
    const timer = setTimeout(() => {
      const reply: CollaborationMessage = {
        id: `msg-bot-${Date.now()}`,
        author: leader?.name ?? '项目助手',
        from: 'bot',
        text: replyText,
        time: '刚刚',
        simulated: true,
      }
      setMessagesByRoom((current) => ({ ...current, [activeRoom.id]: [...(current[activeRoom.id] ?? []), reply] }))
    }, 720)
    replyTimers.current.push(timer)
  }

  const advanceTask = (taskId: string, next: TaskPhase, note: string) => {
    setTasks((current) =>
      current.map((task) => {
        if (task.id !== taskId) return task
        return { ...task, phase: next, events: [...task.events, `${nowLabel()} · ${note}`] }
      }),
    )
    showToast(`任务状态已更新为「${next}」（本地演示）`)
  }

  const createTask = (input: NewTaskInput) => {
    const executor = collaborationBots.find((bot) => bot.id === input.executorId)
    const task: CollaborationTask = {
      id: `task-${Date.now()}`,
      roomId: activeRoom.id,
      projectId: activeRoom.projectIds[0] ?? '',
      issueId: '',
      title: input.title,
      owner: '林然',
      executorId: input.executorId,
      phase: executor?.online ? '待开始' : '受阻',
      environment: '测试',
      source: input.source,
      note: input.title,
      events: [`${nowLabel()} · 已建立任务`],
      references: [],
    }
    setTasks((current) => [task, ...current])
    setSelectedTaskId(task.id)
    setPanel('task')
    setChatTab('对话')
    if (executor?.online) {
      showToast('任务已创建（本地演示）')
    } else {
      showToast('任务已创建，执行者离线已标记受阻（本地演示）')
    }
  }

  const saveRoomSettings = (settings: RoomSettingsOverride) => {
    setRoomOverrides((current) => ({ ...current, [activeRoom.id]: settings }))
    setSettingsOpen(false)
    showToast('会话设置已保存（本地演示）')
  }

  const toggleTaskPanel = () => {
    if (panel === 'task') {
      setPanel(null)
      return
    }
    if (!activeTask) {
      showToast('当前会话还没有任务，可点击「新建任务」创建。')
      return
    }
    setSelectedTaskId(activeTask.id)
    setPanel('task')
  }

  const openRoomTask = (task: CollaborationTask) => {
    setSelectedTaskId(task.id)
    setPanel('task')
    setInboxActive(false)
  }

  const toggleChatMenu = () => setChatMenuOpen((current) => !current)

  return (
    <div className={cn('collab-layout', mobileRoomsOpen && 'mobile-rooms-open')}>
      <h1 className="sr-only">协作</h1>
      {mobileRoomsOpen && (
        <button
          type="button"
          className="mobile-rooms-backdrop"
          aria-label="关闭会话列表"
          onClick={() => setMobileRoomsOpen(false)}
        />
      )}
      <ConversationList
        rooms={rooms}
        bots={collaborationBots}
        messagesByRoom={messagesByRoom}
        activeRoomId={activeRoom.id}
        unreadByRoom={unreadByRoom}
        query={query}
        onQueryChange={setQuery}
        onSelect={selectRoom}
        inboxCount={inboxTasks.length}
        inboxActive={inboxActive}
        onOpenInbox={() => {
          setInboxActive(true)
          setSettingsOpen(false)
          setMobileRoomsOpen(false)
        }}
        onCreateTask={() => setNewTaskOpen(true)}
        readOnly={readOnly}
      />

      {inboxActive ? (
        <section className="conversation-main dsh-chat" aria-label="待你处理">
          <ProtoWorkPageHead title="待你处理">
            <ProtoButton onClick={() => setInboxActive(false)}>返回会话</ProtoButton>
          </ProtoWorkPageHead>
          <div className="work-padding">
            {inboxTasks.length > 0 ? (
              inboxTasks.map((task) => (
                <button type="button" className="work-task-row" key={task.id} onClick={() => openInboxTask(task)}>
                  <span>
                    <strong>{task.title}</strong>
                    <small>
                      {rooms.find((room) => room.id === task.roomId)?.name ?? '未归属会话'}
                      {' · '}业务负责人 {task.owner}
                      {' · '}执行者 {executorNameFor(task.executorId)}
                    </small>
                  </span>
                  <ProtoChip tone={phaseTone(task.phase)}>{task.phase}</ProtoChip>
                </button>
              ))
            ) : (
              <ProtoEmpty title="暂时没有需要你处理的工作" description="任务的待开始、待验收与受阻结果会出现在这里。" />
            )}
          </div>
        </section>
      ) : (
        <section className="conversation-main dsh-chat" aria-label="当前会话">
          <header className="dsh-chat-header">
            <div className="dsh-title-row">
              <button
                type="button"
                className="dsh-icon-btn dsh-room-toggle"
                aria-label="打开会话列表"
                onClick={() => setMobileRoomsOpen(true)}
              >
                <PrototypeIcon name="menu" />
              </button>
              {readOnly ? (
                <div className="dsh-title">
                  <span className="dsh-title-avatar">
                    <RoomAvatar room={activeRoom} bots={collaborationBots} />
                  </span>
                  <span className="dsh-title-text">
                    <strong>{activeRoom.name}</strong>
                    <small>
                      {roomMeta}
                      {tagsLabel ? ` · ${tagsLabel}` : ''}
                    </small>
                  </span>
                </div>
              ) : (
                <button
                  type="button"
                  className="dsh-title"
                  aria-label={`${activeRoom.name}的会话设置`}
                  onClick={() => setSettingsOpen(true)}
                >
                  <span className="dsh-title-avatar">
                    <RoomAvatar room={activeRoom} bots={collaborationBots} />
                  </span>
                  <span className="dsh-title-text">
                    <strong>{activeRoom.name}</strong>
                    <small>
                      {roomMeta}
                      {tagsLabel ? ` · ${tagsLabel}` : ''}
                    </small>
                  </span>
                </button>
              )}
              <div className="dsh-title-actions">
                {readOnly && <ProtoChip tone="selected">只读</ProtoChip>}
                <button
                  type="button"
                  className="dsh-icon-btn"
                  aria-label="任务列表"
                  title="任务列表"
                  aria-pressed={panel === 'task'}
                  onClick={toggleTaskPanel}
                >
                  <PrototypeIcon name="file" />
                  {roomTasks.length > 0 && <span className="dsh-icon-badge">{roomTasks.length}</span>}
                </button>
                <button
                  type="button"
                  className="dsh-icon-btn"
                  aria-label="会话设置"
                  title="会话设置"
                  onClick={() => setSettingsOpen(true)}
                >
                  <PrototypeIcon name="settings" />
                </button>
              </div>
            </div>
            <nav className="dsh-tabs" role="tablist" aria-label="会话视图">
              {chatTabs.map((tab) => (
                <button
                  key={tab}
                  type="button"
                  role="tab"
                  aria-selected={chatTab === tab}
                  className={cn('dsh-tab', chatTab === tab && 'is-active')}
                  onClick={() => setChatTab(tab)}
                >
                  <span className="dsh-tab-label">{tab}</span>
                  {badgeCounts[tab] > 0 && <span className="dsh-tab-count">{badgeCounts[tab]}</span>}
                </button>
              ))}
              <button
                type="button"
                className="dsh-tab-more"
                aria-label="更多会话操作"
                title="更多"
                aria-haspopup="dialog"
                onClick={toggleChatMenu}
              >
                <PrototypeIcon name="more" />
              </button>
            </nav>
          </header>

          {chatTab === '对话' && (
            <div className="dsh-scroll-area">
              <div className="dsh-chat-scroll">
                <MessageList messages={activeMessages} room={activeRoom} bots={collaborationBots} />
              </div>
              {readOnly ? (
                <p className="dsh-readonly-note">浏览者只读；发送消息与任务推进需要开发者或管理员角色。</p>
              ) : (
                <form
                  className="dsh-composer"
                  onSubmit={(event) => {
                    event.preventDefault()
                    sendMessage()
                  }}
                >
                  <div className="mention-results" id="work-mentions" role="group" aria-label="引用资源候选">
                    {mentionQuery !== null &&
                      mentionOptions.map((candidate) => (
                        <button
                          type="button"
                          className="mention-choice"
                          key={candidate.token}
                          onClick={() => insertMention(candidate)}
                        >
                          {candidate.token} <small>{candidate.type}</small>
                        </button>
                      ))}
                    {mentionQuery !== null && mentionOptions.length === 0 && (
                      <button type="button" className="mention-choice" disabled>
                        没有匹配的引用
                      </button>
                    )}
                  </div>
                  <textarea
                    ref={textareaRef}
                    rows={1}
                    name="message"
                    className="dsh-composer-input"
                    aria-label="协作消息"
                    placeholder={`发消息给 ${activeRoom.name}，输入 @ 引用资源`}
                    value={draft}
                    onChange={(event) => {
                      setDraft(event.target.value)
                      updateMentionQuery(event.target.value, event.target.selectionStart)
                    }}
                    onKeyDown={(event) => {
                      if (event.nativeEvent.isComposing) return
                      if (event.key === 'Escape' && mentionQuery !== null) {
                        setMentionQuery(null)
                        return
                      }
                      if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault()
                        sendMessage()
                      }
                    }}
                  />
                  <div className="dsh-composer-bar">
                    <button
                      type="button"
                      className="dsh-icon-btn composer-add"
                      aria-label="插入资源引用"
                      title="插入资源引用"
                      onClick={() => {
                        setMentionQuery('')
                        textareaRef.current?.focus()
                      }}
                    >
                      <PrototypeIcon name="plus" />
                    </button>
                    <span className="dsh-composer-hint">本地演示 · 未调用模型</span>
                    <span className="spacer" />
                    <button type="submit" className="dsh-send" aria-label="发送消息" disabled={!draft.trim()}>
                      <PrototypeIcon name="send" />
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}
          {chatTab === '轨迹' && <ActivityPanel room={activeRoom} />}
          {chatTab === '上下文' && <ContextPanel room={activeRoom} tasks={roomTasks} projects={data.projects} />}
          {chatTab === '编队' && (
            <TeamPanel
              room={activeRoom}
              bots={collaborationBots}
              tasks={roomTasks}
              projectNameFor={projectNameFor}
              executorNameFor={executorNameFor}
              readOnly={readOnly}
              onManageMembers={() => setSettingsOpen(true)}
              onCreateTask={() => setNewTaskOpen(true)}
              onOpenTask={openRoomTask}
              onOpenTaskPanel={toggleTaskPanel}
            />
          )}
        </section>
      )}

      {settingsOpen ? (
        <RoomSettingsPanel
          key={activeRoom.id}
          room={activeRoom}
          bots={collaborationBots}
          projects={data.projects}
          readOnly={readOnly}
          onSave={saveRoomSettings}
          onClose={() => setSettingsOpen(false)}
        />
      ) : panel === 'task' && activeTask && !inboxActive ? (
        <TaskPanel
          task={activeTask}
          executorName={executorNameFor(activeTask.executorId)}
          projectName={projectNameFor(activeTask.projectId)}
          readOnly={readOnly}
          onClose={() => setPanel(null)}
          onAdvance={(next, note) => advanceTask(activeTask.id, next, note)}
        />
      ) : null}

      <PrototypeDialog open={chatMenuOpen} title="会话操作" onClose={() => setChatMenuOpen(false)}>
        <div className="chat-menu-actions">
          <ProtoButton
            disabled={readOnly}
            onClick={() => {
              setChatMenuOpen(false)
              setNewTaskOpen(true)
            }}
          >
            创建任务
          </ProtoButton>
          <ProtoButton
            onClick={() => {
              setChatMenuOpen(false)
              toggleTaskPanel()
            }}
          >
            任务面板
          </ProtoButton>
          <ProtoButton
            onClick={() => {
              setChatMenuOpen(false)
              setSettingsOpen(true)
            }}
          >
            会话设置
          </ProtoButton>
        </div>
        <p className="small muted">AI 回复、执行轨迹与耗时均为本地演示，不调用模型或执行器。</p>
      </PrototypeDialog>

      <NewTaskDialog
        key={`${activeRoom.id}-${newTaskOpen ? 'open' : 'closed'}`}
        open={newTaskOpen}
        onClose={() => setNewTaskOpen(false)}
        room={activeRoom}
        readOnly={readOnly}
        onCreate={createTask}
      />
    </div>
  )
}
