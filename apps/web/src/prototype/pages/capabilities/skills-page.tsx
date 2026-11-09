import { useState } from 'react'
import { useNavigate } from 'react-router'
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
import { usePrototype } from '@/prototype/data/store'
import { copyText, downloadTextFile, skillCategories, useCapabilityData } from '@/prototype/data/capabilities'
import type { DemoBot, DemoSkill, SkillCategory } from '@/prototype/data/capabilities'

/** Skill 分类筛选值；全部表示不限制分类。 */
const skillFilterCategories: readonly ('全部' | SkillCategory)[] = ['全部', ...skillCategories]

/** 技能调用标识的校验规则，对应 @skill/ 前缀后的标识。 */
const skillIdPattern = /^[a-z0-9]+(-[a-z0-9]+)*$/

/** 版本号校验规则，保持与旧原型一致的三段式版本。 */
const skillVersionPattern = /^\d+\.\d+\.\d+$/

/**
 * 拼接 Skill 的 SKILL.md 展示与下载内容。
 * @param skill 当前技能。
 * @returns 标题加指令正文的 Markdown 文本。
 */
function skillSource(skill: DemoSkill): string {
  return `# ${skill.name}\n\n${skill.instructions}`
}

/** 发布或编辑 Skill 的提交值。 */
interface SkillFormValues {
  id: string
  name: string
  category: SkillCategory
  version: string
  description: string
  instructions: string
}

/**
 * 渲染发布或编辑 Skill 的表单对话框，表单结构对齐原型 `#skill-form`。
 * @param props.skill 待编辑技能；为空时表示发布新技能。
 * @param props.existingIds 当前团队已存在的调用标识，用于新建时查重。
 * @param props.onSave 校验通过后的保存回调。
 * @param props.onOpenChange 关闭对话框的回调。
 * @returns 原型 `.form-grid`/`.field` 结构的 Skill 表单。
 */
function SkillFormDialog({
  skill,
  existingIds,
  onSave,
  onOpenChange,
}: {
  skill: DemoSkill | null
  existingIds: string[]
  onSave: (values: SkillFormValues) => void
  onOpenChange: (open: boolean) => void
}) {
  const [skillId, setSkillId] = useState(skill?.id ?? '')
  const [name, setName] = useState(skill?.name ?? '')
  const [category, setCategory] = useState<SkillCategory>(skill?.category ?? '研发')
  const [version, setVersion] = useState(skill?.version ?? '1.0.0')
  const [description, setDescription] = useState(skill?.description ?? '')
  const [instructions, setInstructions] = useState(skill?.instructions ?? '')
  const [error, setError] = useState('')

  const submit = () => {
    const trimmedId = skillId.trim()
    if (!skill && !skillIdPattern.test(trimmedId)) {
      setError('调用标识只允许小写字母、数字和连字符，例如 api-review。')
      return
    }
    if (!skill && existingIds.includes(trimmedId)) {
      setError('调用标识已存在，请换一个。')
      return
    }
    if (!name.trim() || !description.trim() || !instructions.trim()) {
      setError('请填写名称、简述和 SKILL.md 指令。')
      return
    }
    if (!skillVersionPattern.test(version.trim())) {
      setError('版本号需要形如 1.0.0。')
      return
    }
    onSave({
      id: trimmedId,
      name: name.trim(),
      category,
      version: version.trim(),
      description: description.trim(),
      instructions: instructions.trim(),
    })
  }

  return (
    <PrototypeDialog open title={skill ? '编辑 Skill' : '发布团队 Skill'} onClose={() => onOpenChange(false)}>
      <form
        id="skill-form"
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <div className="form-grid">
          <ProtoField label="名称">
            <input name="name" value={name} maxLength={30} onChange={(event) => setName(event.target.value)} />
          </ProtoField>
          <ProtoField label="调用标识">
            <input
              name="id"
              value={skillId}
              maxLength={40}
              readOnly={Boolean(skill)}
              placeholder="如 api-review"
              onChange={(event) => setSkillId(event.target.value)}
            />
          </ProtoField>
          <ProtoField label="分类">
            <select
              name="category"
              value={category}
              onChange={(event) => {
                const nextCategory = skillCategories.find((item) => item === event.target.value)
                if (nextCategory) setCategory(nextCategory)
              }}
            >
              {skillCategories.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </ProtoField>
          <ProtoField label="版本">
            <input
              name="version"
              value={version}
              maxLength={20}
              placeholder="1.0.0"
              onChange={(event) => setVersion(event.target.value)}
            />
          </ProtoField>
          <ProtoField label="简述" full>
            <input
              name="description"
              value={description}
              maxLength={100}
              placeholder="一句话说明何时使用这个 Skill"
              onChange={(event) => setDescription(event.target.value)}
            />
          </ProtoField>
          <ProtoField label="SKILL.md 指令" full>
            <textarea
              name="instructions"
              value={instructions}
              maxLength={6000}
              placeholder="描述何时使用、操作步骤和输出要求"
              onChange={(event) => setInstructions(event.target.value)}
            />
          </ProtoField>
        </div>
        <p className="field-error" role="alert">
          {error}
        </p>
        <div className="form-actions">
          <ProtoButton onClick={() => onOpenChange(false)}>取消</ProtoButton>
          <ProtoButton variant="primary" type="submit">
            {skill ? '保存修改' : '发布到团队'}
          </ProtoButton>
        </div>
      </form>
    </PrototypeDialog>
  )
}

/**
 * 渲染「在 bots 中使用」的智能体选择对话框，复用原型 `.project-chat-picker` 结构。
 * @param props.skill 待使用的技能。
 * @param props.bots 已启用该技能且运行环境可用的当前团队智能体。
 * @param props.onClose 关闭选择器。
 * @param props.onSelect 选择智能体后的回调。
 * @param props.onManageBots 没有可用智能体时跳转智能体目录。
 * @returns 智能体选择对话框；不打开真实会话。
 */
function SkillBotPickerDialog({
  skill,
  bots,
  onClose,
  onSelect,
  onManageBots,
}: {
  skill: DemoSkill
  bots: DemoBot[]
  onClose: () => void
  onSelect: (bot: DemoBot) => void
  onManageBots: () => void
}) {
  return (
    <PrototypeDialog open title={`使用 ${skill.name}`} onClose={onClose}>
      {bots.length > 0 ? (
        <>
          <p className="section-note">选择智能体，项目资源可以稍后在会话中引用。</p>
          <div className="project-chat-picker">
            {bots.map((bot) => (
              <button key={bot.id} type="button" onClick={() => onSelect(bot)}>
                <BotAvatar name={bot.name} />
                <span>
                  <strong>{bot.name}</strong>
                  <small>{bot.role}</small>
                </span>
                <PrototypeIcon name="arrow" />
              </button>
            ))}
          </div>
        </>
      ) : (
        <ProtoEmpty
          icon="bot"
          title="没有可用的智能体"
          description="请给 Bot 配置此技能，并确认运行环境可用。"
          action={<ProtoButton onClick={onManageBots}>管理智能体</ProtoButton>}
        />
      )}
    </PrototypeDialog>
  )
}

/**
 * 渲染能力中心的 Skills 技能库页面，结构与原型 `skillsPage` 一致。
 * @returns 分类筛选、搜索、技能卡片与详情、发布和启停交互；数据保存在浏览器本地。
 */
export function SkillsPage() {
  const navigate = useNavigate()
  const { openMenu } = usePrototypeMenu()
  const { currentTeam, currentRole, showToast } = usePrototype()
  const { data, updateData } = useCapabilityData(showToast)
  const [category, setCategory] = useState<'全部' | SkillCategory>('全部')
  const [search, setSearch] = useState('')
  const [detailSkillId, setDetailSkillId] = useState<string | null>(null)
  const [botPickerSkillId, setBotPickerSkillId] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [editingSkill, setEditingSkill] = useState<DemoSkill | null>(null)

  const readOnly = currentRole === '浏览者'
  const teamSkills = data.skills.filter((skill) => skill.teamId === currentTeam.id)
  const teamBots = data.bots.filter((bot) => bot.teamId === currentTeam.id)
  const keyword = search.trim().toLowerCase()
  const visibleSkills = teamSkills.filter((skill) => {
    const matchesCategory = category === '全部' || skill.category === category
    const matchesKeyword = !keyword || `${skill.name} ${skill.id} ${skill.description}`.toLowerCase().includes(keyword)
    return matchesCategory && matchesKeyword
  })
  const detailSkill = teamSkills.find((skill) => skill.id === detailSkillId) ?? null
  const pickerSkill = teamSkills.find((skill) => skill.id === botPickerSkillId) ?? null
  const pickerBots = pickerSkill
    ? teamBots.filter((bot) => bot.enabled && bot.online && bot.skills.includes(pickerSkill.id))
    : []

  const openCreate = () => {
    if (readOnly) return
    setEditingSkill(null)
    setFormOpen(true)
  }

  const openEdit = (skill: DemoSkill) => {
    if (readOnly) return
    setDetailSkillId(null)
    setEditingSkill(skill)
    setFormOpen(true)
  }

  const saveSkill = (values: SkillFormValues) => {
    if (editingSkill) {
      updateData((current) => ({
        ...current,
        skills: current.skills.map((skill) =>
          skill.id === editingSkill.id && skill.teamId === editingSkill.teamId
            ? {
                ...skill,
                name: values.name,
                category: values.category,
                version: values.version,
                description: values.description,
                instructions: values.instructions,
              }
            : skill,
        ),
      }))
      showToast(`已保存 Skill「${values.name}」（本地演示）`)
    } else {
      const skill: DemoSkill = {
        id: values.id,
        teamId: currentTeam.id,
        name: values.name,
        category: values.category,
        description: values.description,
        instructions: values.instructions,
        version: values.version,
        source: '团队维护',
        enabled: true,
      }
      updateData((current) => ({ ...current, skills: [...current.skills, skill] }))
      showToast(`已发布 Skill「${skill.name}」（本地演示）`)
    }
    setFormOpen(false)
    setEditingSkill(null)
  }

  const toggleSkill = (skill: DemoSkill) => {
    if (readOnly) return
    updateData((current) => ({
      ...current,
      skills: current.skills.map((item) =>
        item.id === skill.id && item.teamId === skill.teamId ? { ...item, enabled: !item.enabled } : item,
      ),
    }))
    showToast(skill.enabled ? `已停用「${skill.name}」，已配置的智能体不会在运行中使用。` : `已启用「${skill.name}」。`)
  }

  const copySkillContent = async (skill: DemoSkill) => {
    const copied = await copyText(skillSource(skill))
    showToast(copied ? '已复制 SKILL.md 内容' : '浏览器未允许自动复制，请手动选择内容。')
  }

  const downloadSkill = (skill: DemoSkill) => {
    downloadTextFile('SKILL.md', skillSource(skill))
    showToast('已生成 SKILL.md 下载文件')
  }

  const openSkillBotPicker = (skill: DemoSkill) => {
    if (readOnly || !skill.enabled) return
    setDetailSkillId(null)
    setBotPickerSkillId(skill.id)
  }

  const selectBotForSkill = (skill: DemoSkill, bot: DemoBot) => {
    setBotPickerSkillId(null)
    setDetailSkillId(null)
    showToast(`已选择 ${bot.name} 使用「${skill.name}」；独立会话将在协作页迁移后接入。`)
  }

  const clearFilters = () => {
    setCategory('全部')
    setSearch('')
  }

  const detailEnabled = detailSkill?.enabled ?? false

  return (
    <>
      <header className="page-head skills-header">
        <div className="row">
          <ProtoIconButton label="展开导航" icon="menu" className="mobile-menu" onClick={openMenu} />
          <h1 className="sr-only">Skills</h1>
          <ProtoButton variant="primary" disabled={readOnly} onClick={openCreate}>
            <PrototypeIcon name="plus" />
            发布 Skill
          </ProtoButton>
        </div>
        <div className="tabs" role="tablist" aria-label="Skills 内容">
          <button type="button" role="tab" className="tab" aria-selected={true}>
            技能库
          </button>
          <button
            type="button"
            role="tab"
            className="tab"
            aria-selected={false}
            onClick={() => navigate('/prototype/capabilities/templates')}
          >
            AGENTS.md 模板
          </button>
        </div>
      </header>

      <div className="catalog skills-catalog">
        <div className="skill-toolbar">
          <div className="category-pills" role="group" aria-label="Skill 分类">
            {skillFilterCategories.map((item) => (
              <button
                key={item}
                type="button"
                aria-pressed={category === item}
                className={category === item ? 'active' : undefined}
                onClick={() => setCategory(item)}
              >
                {item}
              </button>
            ))}
          </div>
          <ProtoSearch label="搜索 Skills" placeholder="搜索团队技能" value={search} onChange={setSearch} />
        </div>

        {visibleSkills.length > 0 ? (
          <div className="skill-grid">
            {visibleSkills.map((skill) => (
              <article key={skill.id} className="skill-card">
                <div className="row">
                  <span className="skill-glyph">
                    <PrototypeIcon name="skill" />
                  </span>
                  <span className="spacer" />
                  <span className={`skill-state ${skill.enabled ? 'enabled' : ''}`}>
                    <span className={`dot ${skill.enabled ? 'green' : ''}`} />
                    {skill.enabled ? '已启用' : '已停用'}
                  </span>
                </div>
                <button type="button" className="skill-title" onClick={() => setDetailSkillId(skill.id)}>
                  {skill.name}
                </button>
                <p>{skill.description}</p>
                <div className="skill-meta">
                  <span>{skill.category}</span>
                  <span>v{skill.version}</span>
                  <span className="spacer" />
                  <span>{skill.source}</span>
                </div>
                <div className="skill-card-footer">
                  <code>@skill/{skill.id}</code>
                  <ProtoIconButton
                    label={`使用${skill.name}`}
                    icon="send"
                    disabled={!skill.enabled || readOnly}
                    onClick={() => openSkillBotPicker(skill)}
                  />
                </div>
              </article>
            ))}
          </div>
        ) : (
          <ProtoEmpty
            icon="search"
            title={teamSkills.length === 0 ? '还没有团队 Skill' : '没有找到技能'}
            description={
              teamSkills.length === 0
                ? '发布第一个 Skill，把团队的固定做法沉淀为指令。'
                : '换个关键词，或查看全部分类。'
            }
            action={
              teamSkills.length > 0 ? (
                <ProtoButton onClick={clearFilters}>清除筛选</ProtoButton>
              ) : readOnly ? (
                <ProtoChip tone="warning">浏览者只读</ProtoChip>
              ) : (
                <ProtoButton onClick={openCreate}>
                  <PrototypeIcon name="plus" />
                  发布 Skill
                </ProtoButton>
              )
            }
          />
        )}
      </div>

      {detailSkill && (
        <PrototypeDialog open title={detailSkill.name} onClose={() => setDetailSkillId(null)}>
          <div className="row">
            <span className="badge">{detailSkill.category}</span>
            <span className="badge">v{detailSkill.version}</span>
            <span className="spacer" />
            {readOnly && <ProtoChip tone="warning">只读</ProtoChip>}
            <span className="small muted">{detailEnabled ? '已启用' : '已停用'}</span>
          </div>
          <p className="skill-description">{detailSkill.description}</p>
          <div className="document-toolbar">
            <ProtoButton
              onClick={() => {
                void copySkillContent(detailSkill)
              }}
            >
              <PrototypeIcon name="copy" />
              复制内容
            </ProtoButton>
            <ProtoButton onClick={() => downloadSkill(detailSkill)}>
              <PrototypeIcon name="download" />
              下载 SKILL.md
            </ProtoButton>
          </div>
          <div className="file-head">
            <span>SKILL.md</span>
            <code>@skill/{detailSkill.id}</code>
          </div>
          <pre className="skill-source">{skillSource(detailSkill)}</pre>
          <div className="form-actions">
            <ProtoButton disabled={readOnly} onClick={() => openEdit(detailSkill)}>
              编辑
            </ProtoButton>
            <ProtoButton disabled={readOnly} onClick={() => toggleSkill(detailSkill)}>
              {detailEnabled ? '停用' : '启用'}
            </ProtoButton>
            <span className="spacer" />
            <ProtoButton
              variant="primary"
              disabled={readOnly || !detailEnabled}
              onClick={() => openSkillBotPicker(detailSkill)}
            >
              在 bots 中使用
            </ProtoButton>
          </div>
        </PrototypeDialog>
      )}

      {pickerSkill && (
        <SkillBotPickerDialog
          skill={pickerSkill}
          bots={pickerBots}
          onClose={() => setBotPickerSkillId(null)}
          onSelect={(bot) => selectBotForSkill(pickerSkill, bot)}
          onManageBots={() => {
            setBotPickerSkillId(null)
            navigate('/prototype/capabilities/bots')
          }}
        />
      )}

      {formOpen && (
        <SkillFormDialog
          skill={editingSkill}
          existingIds={teamSkills.filter((skill) => skill.id !== editingSkill?.id).map((skill) => skill.id)}
          onSave={saveSkill}
          onOpenChange={(open) => {
            if (!open) {
              setFormOpen(false)
              setEditingSkill(null)
            }
          }}
        />
      )}
    </>
  )
}
