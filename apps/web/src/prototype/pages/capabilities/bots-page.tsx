import { useState } from 'react'
import { createPortal } from 'react-dom'
import { PrototypeDialog } from '@/prototype/components/prototype-dialog'
import { BotAvatar } from '@/prototype/components/avatar'
import {
  ProtoButton,
  ProtoEmpty,
  ProtoField,
  ProtoIconButton,
  ProtoSearch,
} from '@/prototype/components/proto-controls'
import { ProtoChip } from '@/prototype/components/proto'
import { PrototypeIcon } from '@/prototype/icons/icon'
import { usePrototypeMenu } from '@/prototype/layout/prototype-shell'
import { demoMembers } from '@/prototype/data/seed'
import { usePrototype } from '@/prototype/data/store'
import { botModels, botRuntimes, createLocalId, useCapabilityData } from '@/prototype/data/capabilities'
import type { BotRuntime, DemoBot, DemoBotRun, DemoSkill } from '@/prototype/data/capabilities'
import type { DemoProject } from '@/prototype/data/types'

/** 智能体目录筛选值，与原型 agent-filters 的页签一致。 */
type BotFilter = '全部智能体' | '我负责的'

/** 由全局状态与运行环境推导的智能体状态。 */
interface BotStatusInfo {
  label: string
  dot: 'green' | 'amber' | ''
}

/** 智能体详情的页签，保持原型「配置 / 项目 / 运行记录」的划分。 */
type BotDetailTab = '配置' | '项目授权' | '运行记录'

/**
 * 推导智能体状态，区分全局停用、运行环境离线与可用。
 * @param bot 当前智能体。
 * @returns 状态文案与状态点颜色；不改变数据。
 */
function botStatusInfo(bot: DemoBot): BotStatusInfo {
  if (!bot.enabled) return { label: '已停用', dot: '' }
  if (!bot.online) return { label: '环境离线', dot: 'amber' }
  return { label: '可用', dot: 'green' }
}

/**
 * 查找运行记录所属项目名称。
 * @param projectId 项目标识。
 * @param projects 当前团队项目列表。
 * @returns 项目名称；不在当前团队时回退为项目标识。
 */
function projectNameOf(projectId: string, projects: DemoProject[]): string {
  return projects.find((project) => project.id === projectId)?.name ?? projectId
}

/** 智能体配置表单的提交值。 */
interface BotFormValues {
  name: string
  role: string
  owner: string
  runtime: BotRuntime
  model: string
  instructions: string
  skills: string[]
}

/**
 * 渲染创建或编辑智能体的表单对话框，表单结构对齐原型客户端表单。
 * @param props.bot 待编辑智能体；为空时表示创建。
 * @param props.teamSkills 当前团队可选的 Skills。
 * @param props.onSave 校验通过后的保存回调。
 * @param props.onOpenChange 关闭对话框的回调。
 * @returns 原型 `.form-grid`/`.field`/`.skill-checkboxes` 结构的智能体表单。
 */
function BotFormDialog({
  bot,
  teamSkills,
  onSave,
  onOpenChange,
}: {
  bot: DemoBot | null
  teamSkills: DemoSkill[]
  onSave: (values: BotFormValues) => void
  onOpenChange: (open: boolean) => void
}) {
  const [name, setName] = useState(bot?.name ?? '')
  const [role, setRole] = useState(bot?.role ?? '')
  const [owner, setOwner] = useState(bot?.owner ?? demoMembers[0])
  const [runtime, setRuntime] = useState<BotRuntime>(bot?.runtime ?? '团队执行器')
  const [model, setModel] = useState(bot?.model ?? botModels[0])
  const [instructions, setInstructions] = useState(bot?.instructions ?? '')
  const [skills, setSkills] = useState<string[]>(bot?.skills ?? [])
  const [error, setError] = useState('')

  const toggleSkill = (skillId: string, checked: boolean) => {
    setSkills((current) =>
      checked ? (current.includes(skillId) ? current : [...current, skillId]) : current.filter((id) => id !== skillId),
    )
  }

  const submit = () => {
    if (!name.trim() || !role.trim() || !instructions.trim()) {
      setError('请填写名称、职责和职责说明。')
      return
    }
    onSave({
      name: name.trim(),
      role: role.trim(),
      owner,
      runtime,
      model,
      instructions: instructions.trim(),
      skills,
    })
  }

  return (
    <PrototypeDialog open title={bot ? '编辑智能体' : '创建智能体'} onClose={() => onOpenChange(false)}>
      <form
        id="bot-form"
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <div className="form-grid">
          <ProtoField label="名称">
            <input
              name="name"
              value={name}
              maxLength={20}
              placeholder="给你的协作者起个名字"
              onChange={(event) => setName(event.target.value)}
            />
          </ProtoField>
          <ProtoField label="职责">
            <input
              name="role"
              value={role}
              maxLength={30}
              placeholder="例如：产品助手"
              onChange={(event) => setRole(event.target.value)}
            />
          </ProtoField>
          <ProtoField label="负责人">
            <select name="owner" value={owner} onChange={(event) => setOwner(event.target.value)}>
              {demoMembers.map((member) => (
                <option key={member} value={member}>
                  {member}
                </option>
              ))}
            </select>
          </ProtoField>
          <ProtoField label="运行环境">
            <select
              name="runtime"
              value={runtime}
              onChange={(event) => {
                const nextRuntime = botRuntimes.find((item) => item === event.target.value)
                if (nextRuntime) setRuntime(nextRuntime)
              }}
            >
              {botRuntimes.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </ProtoField>
          <ProtoField label="模型">
            <select name="model" value={model} onChange={(event) => setModel(event.target.value)}>
              {botModels.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </ProtoField>
          <ProtoField label="职责说明" full>
            <textarea
              name="instructions"
              value={instructions}
              maxLength={2000}
              placeholder="描述长期职责、工作方式与输出要求"
              onChange={(event) => setInstructions(event.target.value)}
            />
          </ProtoField>
          <div className="field full">
            <span>允许使用的 Skills</span>
            <div className="skill-checkboxes">
              {teamSkills.map((skill) => (
                <label key={skill.id}>
                  <input
                    type="checkbox"
                    name="skills"
                    value={skill.id}
                    checked={skills.includes(skill.id)}
                    onChange={(event) => toggleSkill(skill.id, event.target.checked)}
                  />
                  <PrototypeIcon name="skill" />
                  <span>{skill.name}</span>
                  {!skill.enabled && <small>已停用</small>}
                </label>
              ))}
              {teamSkills.length === 0 && <p className="small quiet">当前团队还没有 Skill，发布后可以在这里选择。</p>}
            </div>
          </div>
        </div>
        <p className="field-error" role="alert">
          {error}
        </p>
        <div className="form-actions">
          <ProtoButton onClick={() => onOpenChange(false)}>取消</ProtoButton>
          <ProtoButton variant="primary" type="submit">
            {bot ? '保存配置' : '创建智能体'}
          </ProtoButton>
        </div>
      </form>
    </PrototypeDialog>
  )
}

/**
 * 渲染智能体详情侧栏：配置、项目授权与运行记录。
 * @param props.bot 当前智能体。
 * @param props.teamSkills 当前团队 Skills。
 * @param props.projects 当前团队项目。
 * @param props.runs 当前智能体运行记录。
 * @param props.readOnly 浏览者只读时为 true。
 * @param props.onClose 关闭详情。
 * @param props.onEdit 打开编辑表单。
 * @param props.onToggleEnabled 启用或停用智能体。
 * @param props.onToggleSkill 调整允许使用的 Skill。
 * @param props.onToggleProject 调整项目能力授权。
 * @returns 使用原型 `.details.agent-details` 结构的右侧详情侧栏。
 */
function BotDetailDialog({
  bot,
  teamSkills,
  projects,
  runs,
  readOnly,
  onClose,
  onEdit,
  onToggleEnabled,
  onToggleSkill,
  onToggleProject,
}: {
  bot: DemoBot
  teamSkills: DemoSkill[]
  projects: DemoProject[]
  runs: DemoBotRun[]
  readOnly: boolean
  onClose: () => void
  onEdit: () => void
  onToggleEnabled: () => void
  onToggleSkill: (skillId: string, checked: boolean) => void
  onToggleProject: (projectId: string, checked: boolean) => void
}) {
  const [tab, setTab] = useState<BotDetailTab>('配置')
  const status = botStatusInfo(bot)
  const detailTabs: BotDetailTab[] = ['配置', '项目授权', '运行记录']

  const detailHost = typeof document === 'undefined' ? null : document.getElementById('prototype-detail-host')
  if (!detailHost) return null

  return createPortal(
    <aside className="details agent-details" aria-label="智能体详情">
      <div className="detail-top">
        <h2>智能体详情</h2>
        <span className="spacer" />
        <button type="button" className="icon-btn" aria-label="关闭智能体详情" onClick={onClose}>
          <PrototypeIcon name="close" />
        </button>
      </div>
      <div className="agent-profile">
        <BotAvatar name={bot.name} size="lg" />
        <div>
          <h2>{bot.name}</h2>
          <p>
            {bot.role} · 负责人 {bot.owner}
          </p>
        </div>
        <span className="spacer" />
        <span className="bot-status">
          <span className={`dot ${status.dot}`} />
          {status.label}
        </span>
        {readOnly && <ProtoChip tone="warning">只读</ProtoChip>}
      </div>

      <div className="tabs agent-detail-tabs" role="tablist" aria-label="智能体详情内容">
        {detailTabs.map((item) => (
          <button
            key={item}
            type="button"
            role="tab"
            className="tab"
            aria-selected={tab === item}
            onClick={() => setTab(item)}
          >
            {item}
          </button>
        ))}
      </div>

      <div className="detail-scroll">
        {tab === '配置' && (
          <div>
            <p className="agent-purpose">{bot.instructions}</p>
            <dl className="properties">
              <dt>
                <PrototypeIcon name="user" />
                负责人
              </dt>
              <dd>{bot.owner}</dd>
              <dt>
                <PrototypeIcon name="terminal" />
                运行环境
              </dt>
              <dd>{bot.runtime}</dd>
              <dt>
                <PrototypeIcon name="model" />
                模型
              </dt>
              <dd>{bot.model}</dd>
              <dt>
                <PrototypeIcon name="shield" />
                使用范围
              </dt>
              <dd>独立 Bot · {bot.projectIds.length} 个项目</dd>
            </dl>
            <div className="agent-section">
              <h3>
                可用 Skills <span className="counter">{bot.skills.length}</span>
              </h3>
              <div className="skill-checkboxes">
                {teamSkills.map((skill) => (
                  <label key={skill.id}>
                    <input
                      type="checkbox"
                      checked={bot.skills.includes(skill.id)}
                      disabled={readOnly}
                      aria-label={`${bot.name} 使用技能 ${skill.name}`}
                      onChange={(event) => onToggleSkill(skill.id, event.target.checked)}
                    />
                    <PrototypeIcon name="skill" />
                    <span>{skill.name}</span>
                    {!skill.enabled && <small>已停用</small>}
                  </label>
                ))}
                {teamSkills.length === 0 && <p className="small quiet">当前团队还没有 Skill。</p>}
              </div>
            </div>
          </div>
        )}

        {tab === '项目授权' && (
          <div>
            <p className="small muted">项目能力授权只作用于当前智能体；密钥使用与生产变更需要单独授权。</p>
            <div className="binding-list">
              {projects.map((project) => {
                const authorized = bot.projectIds.includes(project.id)
                return (
                  <div key={project.id} className="binding-card">
                    <div className="row">
                      <PrototypeIcon name="folder" />
                      <strong>{project.name}</strong>
                      <span className="spacer" />
                      <span className="badge">{authorized ? '已授权' : '未授权'}</span>
                    </div>
                    <p>{project.repo}</p>
                    <div className="row">
                      <span className="small muted">项目能力授权</span>
                      <span className="spacer" />
                      <input
                        type="checkbox"
                        className="switch"
                        checked={authorized}
                        disabled={readOnly}
                        aria-label={`授权 ${bot.name} 访问 ${project.name}`}
                        onChange={(event) => onToggleProject(project.id, event.target.checked)}
                      />
                    </div>
                  </div>
                )
              })}
              {projects.length === 0 && (
                <div className="empty">
                  <h3>还没有项目</h3>
                  <p>创建项目后才能授予智能体项目能力。</p>
                </div>
              )}
            </div>
          </div>
        )}

        {tab === '运行记录' && (
          <div className="run-list">
            {runs.map((run) => (
              <article key={run.id}>
                <div className="row">
                  <PrototypeIcon name={run.result === '已完成' ? 'check' : 'clock'} />
                  <strong>{run.title}</strong>
                </div>
                <p>
                  {projectNameOf(run.projectId, projects)} · {run.time}
                </p>
                <span className={`badge ${run.result === '已完成' ? 'green' : ''}`}>{run.result}</span>
              </article>
            ))}
            {runs.length === 0 && (
              <div className="empty">
                <h3>还没有运行记录</h3>
                <p>运行记录为演示数据，不调用模型或执行器。</p>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="agent-detail-actions">
        <ProtoButton disabled={readOnly} onClick={onToggleEnabled}>
          {bot.enabled ? '停用智能体' : '启用智能体'}
        </ProtoButton>
        <ProtoButton variant="primary" disabled={readOnly} onClick={onEdit}>
          编辑配置
        </ProtoButton>
      </div>
    </aside>,
    detailHost,
  )
}

/**
 * 渲染能力中心的智能体目录页，结构与原型 agent-page-header、agent-catalog 一致。
 * @returns 智能体表格、筛选、搜索、创建入口与详情配置；数据保存在浏览器本地。
 */
export function BotsPage() {
  const { openMenu } = usePrototypeMenu()
  const { currentTeam, teamProjects, currentRole, showToast } = usePrototype()
  const { data, updateData } = useCapabilityData(showToast)
  const [filter, setFilter] = useState<BotFilter>('全部智能体')
  const [search, setSearch] = useState('')
  const [selectedBotId, setSelectedBotId] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [editingBot, setEditingBot] = useState<DemoBot | null>(null)

  const readOnly = currentRole === '浏览者'
  const teamBots = data.bots.filter((bot) => bot.teamId === currentTeam.id)
  const teamSkills = data.skills.filter((skill) => skill.teamId === currentTeam.id)
  const keyword = search.trim().toLowerCase()
  const visibleBots = teamBots.filter((bot) => {
    if (filter === '我负责的' && bot.owner !== demoMembers[0]) return false
    return !keyword || `${bot.name} ${bot.role} ${bot.owner}`.toLowerCase().includes(keyword)
  })
  const selectedBot = teamBots.find((bot) => bot.id === selectedBotId) ?? null
  const selectedRuns = selectedBot ? data.runs.filter((run) => run.botId === selectedBot.id) : []
  const hasFilters = filter !== '全部智能体' || search !== ''

  const openCreate = () => {
    if (readOnly) return
    setEditingBot(null)
    setFormOpen(true)
  }

  const openEdit = (bot: DemoBot) => {
    if (readOnly) return
    setSelectedBotId(null)
    setEditingBot(bot)
    setFormOpen(true)
  }

  const saveBot = (values: BotFormValues) => {
    const peers = data.bots.filter(
      (bot) => bot.teamId === currentTeam.id && bot.runtime === values.runtime && bot.id !== editingBot?.id,
    )
    const runtimeOnline = peers.length === 0 ? (editingBot?.online ?? true) : peers.every((bot) => bot.online)
    if (editingBot) {
      updateData((current) => ({
        ...current,
        bots: current.bots.map((bot) =>
          bot.id === editingBot.id ? { ...bot, ...values, online: runtimeOnline } : bot,
        ),
      }))
      showToast(`已保存 ${values.name} 的配置（本地演示）`)
    } else {
      const bot: DemoBot = {
        id: createLocalId('bot'),
        teamId: currentTeam.id,
        name: values.name,
        role: values.role,
        owner: values.owner,
        runtime: values.runtime,
        model: values.model,
        instructions: values.instructions,
        skills: values.skills,
        projectIds: [],
        enabled: true,
        online: runtimeOnline,
        lastActive: '尚未运行',
      }
      updateData((current) => ({ ...current, bots: [...current.bots, bot] }))
      showToast(`已创建智能体 ${bot.name}（本地演示）`)
    }
    setFormOpen(false)
    setEditingBot(null)
  }

  const toggleEnabled = (bot: DemoBot) => {
    if (readOnly) return
    updateData((current) => ({
      ...current,
      bots: current.bots.map((item) => (item.id === bot.id ? { ...item, enabled: !item.enabled } : item)),
    }))
    showToast(bot.enabled ? `${bot.name} 已停用，历史运行记录保留。` : `${bot.name} 已启用。`)
  }

  const toggleSkill = (botId: string, skillId: string, checked: boolean) => {
    if (readOnly) return
    updateData((current) => ({
      ...current,
      bots: current.bots.map((bot) => {
        if (bot.id !== botId) return bot
        const skills = checked
          ? bot.skills.includes(skillId)
            ? bot.skills
            : [...bot.skills, skillId]
          : bot.skills.filter((id) => id !== skillId)
        return { ...bot, skills }
      }),
    }))
  }

  const toggleProject = (botId: string, projectId: string, checked: boolean) => {
    if (readOnly) return
    updateData((current) => ({
      ...current,
      bots: current.bots.map((bot) => {
        if (bot.id !== botId) return bot
        const projectIds = checked
          ? bot.projectIds.includes(projectId)
            ? bot.projectIds
            : [...bot.projectIds, projectId]
          : bot.projectIds.filter((id) => id !== projectId)
        return { ...bot, projectIds }
      }),
    }))
    showToast(checked ? '已授予项目能力（本地演示），未授予密钥或生产变更权限。' : '已撤销项目能力授权（本地演示）。')
  }

  const clearFilters = () => {
    setFilter('全部智能体')
    setSearch('')
  }

  return (
    <>
      <header className="agent-page-header">
        <div className="row">
          <ProtoIconButton label="展开导航" icon="menu" className="mobile-menu" onClick={openMenu} />
          <h1 className="sr-only">智能体目录</h1>
        </div>
        <div className="agent-filters">
          <div className="tabs" role="tablist" aria-label="智能体筛选">
            {(['全部智能体', '我负责的'] as const).map((value) => (
              <button
                key={value}
                type="button"
                role="tab"
                className="tab"
                aria-selected={filter === value}
                onClick={() => setFilter(value)}
              >
                {value}
              </button>
            ))}
          </div>
          <ProtoSearch label="搜索智能体" placeholder="搜索名称、职责或负责人" value={search} onChange={setSearch} />
          <ProtoButton variant="primary" className="new-agent-btn" disabled={readOnly} onClick={openCreate}>
            <PrototypeIcon name="plus" />
            创建智能体
          </ProtoButton>
        </div>
      </header>

      <div className="agent-catalog">
        {visibleBots.length > 0 ? (
          <div className="table-wrap">
            <table className="table agent-table" aria-label="智能体目录">
              <thead>
                <tr>
                  <th>智能体</th>
                  <th>状态</th>
                  <th>使用范围</th>
                  <th>运行环境</th>
                  <th>模型</th>
                  <th>最近活跃</th>
                  <th>
                    <span className="sr-only">操作</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {visibleBots.map((bot) => {
                  const status = botStatusInfo(bot)
                  return (
                    <tr
                      key={bot.id}
                      className={selectedBotId === bot.id ? 'selected' : undefined}
                      tabIndex={0}
                      onClick={() => setSelectedBotId(bot.id)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          setSelectedBotId(bot.id)
                        }
                      }}
                    >
                      <td>
                        <button
                          type="button"
                          className="agent-name"
                          aria-label={`查看${bot.name}详情`}
                          onClick={() => setSelectedBotId(bot.id)}
                        >
                          <BotAvatar name={bot.name} />
                          <span>
                            <strong>{bot.name}</strong>
                            <small>
                              {bot.role}
                              <span> · {bot.owner}</span>
                            </small>
                          </span>
                        </button>
                      </td>
                      <td>
                        <span className="bot-status">
                          <span className={`dot ${status.dot}`} />
                          {status.label}
                        </span>
                      </td>
                      <td>
                        <span className="scope-tag">
                          <PrototypeIcon name="users" />
                          独立 Bot
                        </span>
                      </td>
                      <td>
                        <span className="runtime-cell">
                          <PrototypeIcon name="terminal" />
                          {bot.runtime}
                        </span>
                      </td>
                      <td>
                        <span className="muted small">{bot.model}</span>
                      </td>
                      <td>
                        <span className="quiet small">{bot.lastActive}</span>
                      </td>
                      <td>
                        <ProtoIconButton
                          label={`管理${bot.name}`}
                          icon="more"
                          onClick={(event) => {
                            event.stopPropagation()
                            setSelectedBotId(bot.id)
                          }}
                        />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <ProtoEmpty
            icon="search"
            title={teamBots.length === 0 ? '还没有智能体' : '没有找到智能体'}
            description={
              teamBots.length === 0 ? '创建一个智能体，为团队定义职责、模型与可用技能。' : '试试其他名称或负责人。'
            }
            action={
              hasFilters ? (
                <ProtoButton onClick={clearFilters}>清除筛选</ProtoButton>
              ) : readOnly ? (
                <ProtoChip tone="warning">浏览者只读</ProtoChip>
              ) : (
                <ProtoButton variant="primary" onClick={openCreate}>
                  <PrototypeIcon name="plus" />
                  创建智能体
                </ProtoButton>
              )
            }
          />
        )}
      </div>

      {selectedBot && (
        <BotDetailDialog
          bot={selectedBot}
          teamSkills={teamSkills}
          projects={teamProjects}
          runs={selectedRuns}
          readOnly={readOnly}
          onClose={() => setSelectedBotId(null)}
          onEdit={() => openEdit(selectedBot)}
          onToggleEnabled={() => toggleEnabled(selectedBot)}
          onToggleSkill={(skillId, checked) => toggleSkill(selectedBot.id, skillId, checked)}
          onToggleProject={(projectId, checked) => toggleProject(selectedBot.id, projectId, checked)}
        />
      )}

      {formOpen && (
        <BotFormDialog
          bot={editingBot}
          teamSkills={teamSkills}
          onSave={saveBot}
          onOpenChange={(open) => {
            if (!open) {
              setFormOpen(false)
              setEditingBot(null)
            }
          }}
        />
      )}
    </>
  )
}
