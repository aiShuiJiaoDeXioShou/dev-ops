import { useState } from 'react'
import { BotAvatar, BotGroupAvatar } from '@/prototype/components/avatar'
import { ProtoChip } from '@/prototype/components/proto'
import { PrototypeIcon } from '@/prototype/icons/icon'
import { usePrototype } from '@/prototype/data/store'
import { collaborationBots, collaborationRooms, collaborationTasks } from '@/prototype/data/collaboration'

/**
 * 渲染项目协作页签：只读展示按项目标签归集的会话、消息与任务。
 * @returns 与原型 `.collab-layout` / `.dsh-chat` 结构一致的项目 Bot 会话视图。
 * @remarks 不提供发送消息、新建任务或会话设置入口。
 */
export function ProjectCollaborationPage() {
  const { currentProject } = usePrototype()
  const rooms = collaborationRooms.filter((room) => room.projectIds.includes(currentProject.id))
  const [roomId, setRoomId] = useState(rooms[0]?.id ?? '')
  const activeRoom = rooms.find((room) => room.id === roomId) ?? rooms[0]
  const tasks = collaborationTasks.filter((task) => task.roomId === activeRoom?.id)
  const leader = collaborationBots.find((bot) => bot.id === activeRoom?.leaderId)
  const messages = activeRoom?.messages ?? []

  if (!activeRoom) {
    return (
      <div className="empty">
        <PrototypeIcon name="chat" />
        <h3>没有标签匹配的会话</h3>
        <p>会话或任务带有归属于本项目的标签后，会出现在这里；项目不会因此自动创建群组。</p>
      </div>
    )
  }

  return (
    <div className="collab-layout project-collab-layout">
      <aside className="conversation-list" aria-label="项目会话列表">
        <div className="row conv-tools">
          <h2>相关会话</h2>
          <span className="spacer" />
          <span className="counter">{rooms.length}</span>
        </div>
        <button type="button" className="inbox-link" disabled>
          <PrototypeIcon name="lock" />
          项目协作只读
        </button>
        {rooms.map((room) => {
          const roomLeader = collaborationBots.find((bot) => bot.id === room.leaderId)
          return (
            <button
              key={room.id}
              type="button"
              className={`conversation-item ${room.id === activeRoom.id ? 'active' : ''}`}
              onClick={() => setRoomId(room.id)}
            >
              <span className="conversation-mark">
                {room.kind === 'group' && room.memberIds.length > 1 ? (
                  <BotGroupAvatar
                    names={room.memberIds
                      .map((id) => collaborationBots.find((bot) => bot.id === id)?.name)
                      .filter((name): name is string => Boolean(name))}
                  />
                ) : (
                  <BotAvatar name={roomLeader?.name ?? '项目助手'} size="sm" />
                )}
              </span>
              <span className="conversation-summary">
                <span className="conversation-title-row">
                  <strong>{room.name}</strong>
                </span>
                <small>
                  {roomLeader?.role ?? '智能体'} · {room.messages.length} 条消息
                </small>
              </span>
            </button>
          )
        })}
        <p className="small quiet project-collab-note">会话按工作标签归集；标签与资源引用分别维护。</p>
      </aside>

      <section className="conversation-main dsh-chat" aria-label="项目会话消息">
        <header className="dsh-chat-header">
          <div className="dsh-title-row">
            <div className="dsh-title">
              <span className="dsh-title-avatar">
                {activeRoom.kind === 'group' && activeRoom.memberIds.length > 1 ? (
                  <BotGroupAvatar
                    names={activeRoom.memberIds
                      .map((id) => collaborationBots.find((bot) => bot.id === id)?.name)
                      .filter((name): name is string => Boolean(name))}
                  />
                ) : (
                  <BotAvatar name={leader?.name ?? '项目助手'} size="md" />
                )}
              </span>
              <span className="dsh-title-text">
                <strong>{activeRoom.name}</strong>
                <small>
                  {activeRoom.memberIds.length} 位 Bot · Leader {leader?.name ?? '未设置'}
                </small>
              </span>
            </div>
            <div className="dsh-title-actions">
              <span className="dsh-readonly-pill">只读</span>
            </div>
          </div>
          <nav className="dsh-tabs" role="tablist" aria-label="会话视图">
            <button type="button" role="tab" className="dsh-tab is-active" aria-selected="true">
              <span className="dsh-tab-label">对话</span>
            </button>
            <button type="button" role="tab" className="dsh-tab" aria-selected="false">
              <span className="dsh-tab-label">轨迹</span>
              <span className="dsh-tab-count">{activeRoom.activity.length}</span>
            </button>
            <button type="button" role="tab" className="dsh-tab" aria-selected="false">
              <span className="dsh-tab-label">编队</span>
              <span className="dsh-tab-count">{activeRoom.memberIds.length}</span>
            </button>
          </nav>
        </header>
        <div className="dsh-scroll-area">
          <div className="dsh-chat-scroll">
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
                      <time className="dsh-time">{message.time}</time>
                    </div>
                    <div className="dsh-plain-text">{message.text}</div>
                  </article>
                ),
              )}
            </div>
          </div>
          <p className="dsh-readonly-note">项目协作视图只读；发送消息与执行状态请到全局协作查看。</p>
        </div>
      </section>

      <aside className="work-task-panel" aria-label="项目任务">
        <div className="panel-heading">
          <h2>会话任务</h2>
          <span className="counter">{tasks.length}</span>
        </div>
        <div className="panel-scroll">
          {tasks.length === 0 ? (
            <div className="dsh-empty">
              <span className="dsh-empty-icon">
                <PrototypeIcon name="layers" />
              </span>
              <h3>当前会话还没有任务</h3>
              <p>任务与业务状态分别维护，项目视图不提供新建入口。</p>
            </div>
          ) : (
            tasks.map((task) => (
              <article key={task.id} className="task-card">
                <div className="row">
                  <strong>{task.title}</strong>
                  <span className="spacer" />
                  <ProtoChip>{task.phase}</ProtoChip>
                </div>
                <p className="small muted">
                  执行者：{collaborationBots.find((bot) => bot.id === task.executorId)?.name ?? '未指定'} ·{' '}
                  {task.environment}
                </p>
                {task.issueId && <p className="small blue">{task.issueId}</p>}
                <ol className="task-timeline">
                  {task.events.slice(-3).map((event, index) => (
                    <li key={index}>{event}</li>
                  ))}
                </ol>
              </article>
            ))
          )}
        </div>
      </aside>
    </div>
  )
}
