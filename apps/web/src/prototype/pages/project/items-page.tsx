import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { BotAvatar, MemberAvatar } from '@/prototype/components/avatar'
import { NewItemDialog } from '@/prototype/components/new-item-dialog'
import { ItemWorkflowActions } from '@/prototype/components/item-workflow-actions'
import { ProtoAvatar, ProtoStatus } from '@/prototype/components/proto'
import { PrototypeIcon } from '@/prototype/icons/icon'
import { usePrototype } from '@/prototype/data/store'
import { demoMembers } from '@/prototype/data/seed'
import type { DemoItem } from '@/prototype/data/types'

const statusFilters = ['全部', '未完成', '进行中', '已完成'] as const

/**
 * 判断事项是否符合原型的状态分段筛选。
 * @param item 当前事项；filter 筛选值。
 * @returns 是否应出现在表格中。
 */
function matchesStatusFilter(item: DemoItem, filter: (typeof statusFilters)[number]) {
  if (filter === '全部') return true
  const doneStatuses = item.kind === '需求' ? ['测试通过', '已取消'] : ['已解决', '已关闭']
  const activeStatuses = item.kind === '需求' ? ['开发中', '待测试', '测试中'] : ['修复中', '待回归']
  if (filter === '未完成') return !doneStatuses.includes(item.status)
  if (filter === '已完成') return doneStatuses.includes(item.status)
  return activeStatuses.includes(item.status)
}

/**
 * 渲染项目需求/Bug 列表和右侧详情面板。
 * @param props.kind 事项类型，由项目页签决定。
 * @returns 与原型 itemsPage 结构和类名一致的列表；详情通过原生 dialog 之外的原型 aside 呈现。
 */
export function ItemsPage({ kind }: { kind: DemoItem['kind'] }) {
  const { projectItems, currentProject, currentRole, addComment, showToast } = usePrototype()
  const [filter, setFilter] = useState<(typeof statusFilters)[number]>('全部')
  const [owner, setOwner] = useState('全部负责人')
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detailTab, setDetailTab] = useState<'讨论' | '活动'>('讨论')
  const [comment, setComment] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    const openNew = () => setCreateOpen(true)
    window.addEventListener('prototype:new-item', openNew)
    return () => window.removeEventListener('prototype:new-item', openNew)
  }, [])

  const kindItems = projectItems.filter((item) => item.kind === kind)
  const visibleItems = kindItems.filter((item) => {
    const keyword = query.trim().toLowerCase()
    return (
      matchesStatusFilter(item, filter) &&
      (owner === '全部负责人' || item.owner === owner) &&
      (!keyword || `${item.id} ${item.title}`.toLowerCase().includes(keyword))
    )
  })
  const selectedItem = kindItems.find((item) => item.id === selectedId) ?? null
  const detailHost = typeof document === 'undefined' ? null : document.getElementById('prototype-detail-host')

  const submitComment = () => {
    const text = comment.trim()
    if (!text || currentRole === '浏览者' || !selectedItem) return
    addComment(selectedItem.id, {
      id: `${selectedItem.id}-c-${Date.now()}`,
      author: '林然',
      text,
      time: new Date().toLocaleString('zh-CN'),
    })
    setComment('')
  }

  return (
    <>
      <div className="section-heading">
        <h2>{kind === 'Bug' ? '项目 Bug' : '需求列表'}</h2>
        <span className="counter">{kindItems.length}</span>
      </div>
      <div className="filters">
        <div className="segments">
          {statusFilters.map((value) => (
            <button
              key={value}
              type="button"
              className={`segment ${filter === value ? 'active' : ''}`}
              onClick={() => setFilter(value)}
            >
              {value}
            </button>
          ))}
        </div>
        <select
          className="filter-select"
          aria-label="负责人筛选"
          value={owner}
          onChange={(event) => setOwner(event.target.value)}
        >
          <option value="全部负责人">全部负责人</option>
          {demoMembers.map((member) => (
            <option key={member} value={member}>
              {member}
            </option>
          ))}
        </select>
        <label className="search">
          <PrototypeIcon name="search" />
          <input
            id="item-search"
            aria-label="搜索事项"
            placeholder="搜索标题或编号"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      </div>

      {visibleItems.length === 0 ? (
        <div className="empty">
          <PrototypeIcon name="search" />
          <h3>{kindItems.length > 0 ? '没有符合条件的事项' : `还没有${kind}`}</h3>
          <p>{kindItems.length > 0 ? '试试其他关键词或负责人。' : '创建第一条事项，开始记录目标与进展。'}</p>
          {kindItems.length > 0 ? (
            <button
              type="button"
              className="btn"
              onClick={() => {
                setQuery('')
                setFilter('全部')
                setOwner('全部负责人')
              }}
            >
              清除筛选
            </button>
          ) : currentRole === '浏览者' ? (
            <span className="badge">浏览者只读</span>
          ) : (
            <button type="button" className="btn primary" onClick={() => setCreateOpen(true)}>
              <PrototypeIcon name="plus" />
              新建{kind}
            </button>
          )}
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>事项</th>
                <th>负责人</th>
                <th>业务进度</th>
                <th>代码关联</th>
              </tr>
            </thead>
            <tbody>
              {visibleItems.map((item) => (
                <tr key={item.id} className={selectedId === item.id ? 'selected' : undefined}>
                  <td>
                    <div className="item-cell">
                      <PrototypeIcon name={item.kind === 'Bug' ? 'bug' : 'file'} />
                      <button type="button" className="item-title" onClick={() => setSelectedId(item.id)}>
                        <span className="item-id">{item.id}</span>
                        {item.title}
                      </button>
                    </div>
                  </td>
                  <td>
                    <span className="row">
                      <ProtoAvatar name={item.owner} />
                      {item.owner}
                    </span>
                  </td>
                  <td>
                    <ProtoStatus status={item.status} />
                  </td>
                  <td>
                    {item.pr ? (
                      <button type="button" className="text-btn" onClick={() => setSelectedId(item.id)}>
                        PR #{item.pr}
                      </button>
                    ) : (
                      <span className="quiet">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <span className="sr-only">当前项目：{currentProject.name}</span>

      {selectedItem &&
        detailHost &&
        createPortal(
          <aside className={`details ${expanded ? 'expanded' : ''}`} aria-label="事项详情">
            <div className="detail-top">
              <h2>事项详情</h2>
              <span className="spacer" />
              <button
                type="button"
                className="icon-btn"
                aria-label="编辑事项"
                onClick={() => showToast('编辑表单在原型中尚未接入')}
              >
                <PrototypeIcon name="edit" />
              </button>
              <button
                type="button"
                className="icon-btn"
                aria-label="展开详情"
                onClick={() => setExpanded((value) => !value)}
              >
                <PrototypeIcon name="expand" />
              </button>
              <button type="button" className="icon-btn" aria-label="关闭详情" onClick={() => setSelectedId(null)}>
                <PrototypeIcon name="close" />
              </button>
            </div>
            <div className="detail-scroll">
              <p className="detail-id">{selectedItem.id}</p>
              <h2 className="detail-title">{selectedItem.title}</h2>
              <div className="row spread">
                <ProtoStatus status={selectedItem.status} />
                <span className="small quiet">{selectedItem.kind}业务状态由明确动作流转</span>
              </div>
              <ItemWorkflowActions item={selectedItem} readOnly={currentRole === '浏览者'} />
              <dl className="properties">
                <dt>
                  <PrototypeIcon name="user" />
                  研发负责人
                </dt>
                <dd>{selectedItem.owner}</dd>
                <dt>
                  <PrototypeIcon name="users" />
                  协作成员
                </dt>
                <dd>{selectedItem.collaborators || '未指定'}</dd>
                {selectedItem.tester && (
                  <>
                    <dt>
                      <PrototypeIcon name="user" />
                      测试负责人
                    </dt>
                    <dd>{selectedItem.tester}</dd>
                  </>
                )}
                <dt>
                  <PrototypeIcon name="layers" />
                  所属项目
                </dt>
                <dd>{currentProject.name}</dd>
                <dt>
                  <PrototypeIcon name="repo" />
                  关联仓库
                </dt>
                <dd>{currentProject.repo}</dd>
              </dl>
              <div className="task-actions">
                <button
                  type="button"
                  className="btn primary"
                  disabled={currentRole === '浏览者'}
                  onClick={() => showToast('原型未连接 Bot 任务系统')}
                >
                  交给 Bot 跟进
                </button>
              </div>
              <p className="description">{selectedItem.description}</p>
              {selectedItem.kind === '需求' && (
                <section className="code-links">
                  <h3>关联 Bug</h3>
                  {projectItems
                    .filter((candidate) => candidate.kind === 'Bug' && candidate.requirementId === selectedItem.id)
                    .map((bug) => (
                      <div key={bug.id} className="row">
                        <PrototypeIcon name="bug" />
                        <button type="button" className="text-btn" onClick={() => setSelectedId(bug.id)}>
                          {bug.id} {bug.title}
                        </button>
                        <span className="spacer" />
                        <ProtoStatus status={bug.status} />
                      </div>
                    ))}
                  {projectItems.every(
                    (candidate) => candidate.kind !== 'Bug' || candidate.requirementId !== selectedItem.id,
                  ) && <p className="section-note">暂未关联 Bug</p>}
                </section>
              )}
              <section className="code-links">
                <h3>代码关联</h3>
                <div className="row">
                  <PrototypeIcon name="branch" />
                  <button type="button" className="text-btn" onClick={() => showToast('原型未连接代码平台')}>
                    {selectedItem.branch || 'main'}
                  </button>
                </div>
                {selectedItem.pr ? (
                  <div className="row">
                    <PrototypeIcon name="pr" />
                    <button type="button" className="text-btn" onClick={() => showToast('原型未连接代码平台')}>
                      #{selectedItem.pr} 查看关联变更
                    </button>
                    <span className="spacer" />
                    <span className="badge">待审核</span>
                  </div>
                ) : (
                  <p className="section-note">暂未关联 PR</p>
                )}
                <div className="row">
                  <PrototypeIcon name="commit" />
                  <button type="button" className="text-btn" onClick={() => showToast('原型未连接代码平台')}>
                    a7c92e1
                  </button>
                </div>
              </section>
              <div className="tabs detail-tabs" role="tablist" aria-label="详情内容">
                {(['讨论', '活动'] as const).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    role="tab"
                    className="tab"
                    aria-selected={detailTab === tab}
                    onClick={() => setDetailTab(tab)}
                  >
                    {tab}
                  </button>
                ))}
              </div>
              {detailTab === '讨论' ? (
                selectedItem.comments.length > 0 ? (
                  selectedItem.comments.map((entry) => (
                    <div key={entry.id} className="comment">
                      {entry.bot ? <BotAvatar name={entry.author} size="sm" /> : <MemberAvatar name={entry.author} />}
                      <div className="comment-content">
                        <div className="comment-meta">
                          <strong>{entry.author}</strong>
                          {entry.bot && <span className="badge blue">Bot · 模拟</span>}
                          <span className="quiet">{entry.time}</span>
                        </div>
                        <p className="comment-body">{entry.text}</p>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="section-note">还没有讨论，补充验收说明吧。</p>
                )
              ) : selectedItem.activity.length > 0 ? (
                selectedItem.activity.map((entry, index) => (
                  <p key={index} className="activity-item">
                    {entry}
                  </p>
                ))
              ) : (
                <p className="section-note">还没有活动记录。</p>
              )}
            </div>
            <form
              className="composer"
              onSubmit={(event) => {
                event.preventDefault()
                submitComment()
              }}
            >
              <textarea
                aria-label="讨论内容"
                placeholder="补充说明，或 @项目助手…"
                maxLength={2000}
                value={comment}
                disabled={currentRole === '浏览者'}
                onChange={(event) => setComment(event.target.value)}
              />
              <div className="composer-tools">
                <span className="hint">{currentRole === '浏览者' ? '浏览者只读' : '讨论保存在此浏览器'}</span>
                <button
                  type="submit"
                  className="send"
                  aria-label="发送讨论"
                  disabled={currentRole === '浏览者' || !comment.trim()}
                >
                  <PrototypeIcon name="send" />
                </button>
              </div>
            </form>
          </aside>,
          detailHost,
        )}

      <NewItemDialog kind={kind} open={createOpen} onOpenChange={setCreateOpen} />
    </>
  )
}
