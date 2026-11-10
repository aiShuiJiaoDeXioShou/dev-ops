import { useState } from 'react'
import { useNavigate } from 'react-router'
import { PrototypeDialog } from '@/prototype/components/prototype-dialog'
import { ProtoButton, ProtoEmpty, ProtoField, ProtoIconButton } from '@/prototype/components/proto-controls'
import { ProtoChip } from '@/prototype/components/proto'
import { PrototypeIcon } from '@/prototype/icons/icon'
import { usePrototypeMenu } from '@/prototype/layout/prototype-shell'
import { usePrototype } from '@/prototype/data/store'
import { copyText, createLocalId, downloadTextFile, useCapabilityData } from '@/prototype/data/capabilities'
import type { DemoAgentTemplate } from '@/prototype/data/capabilities'

/** 从当前地址读取要直接预览的模板标识，供「复制预览链接」恢复页面。 */
function initialPreviewId(): string | null {
  const template = new URLSearchParams(window.location.search).get('template')
  return template || null
}

/** AGENTS.md 模板表单的提交值。 */
interface TemplateFormValues {
  name: string
  tag: string
  description: string
  content: string
}

/**
 * 渲染新建、编辑或创建副本的 AGENTS.md 模板表单，结构与原型 `#template-form` 一致。
 * @param props.template 原模板；新建时为空。
 * @param props.duplicate 是否基于原模板创建副本。
 * @param props.onSave 校验通过后的保存回调。
 * @param props.onOpenChange 关闭对话框的回调。
 * @returns 原型 `.form-grid`/`.document-editor` 结构的模板表单。
 */
function TemplateFormDialog({
  template,
  duplicate,
  onSave,
  onOpenChange,
}: {
  template: DemoAgentTemplate | null
  duplicate: boolean
  onSave: (values: TemplateFormValues) => void
  onOpenChange: (open: boolean) => void
}) {
  const [name, setName] = useState(template ? `${template.name}${duplicate ? ' 副本' : ''}` : '')
  const [tag, setTag] = useState(template?.tag ?? '团队')
  const [description, setDescription] = useState(template?.description ?? '')
  const [content, setContent] = useState(template?.content ?? '# AGENTS.md\n\n## 协作约定\n')
  const [error, setError] = useState('')

  const submit = () => {
    if (!name.trim() || !tag.trim() || !content.trim()) {
      setError('名称、分类和正文不能为空。')
      return
    }
    onSave({
      name: name.trim(),
      tag: tag.trim(),
      description: description.trim(),
      content: content.trim(),
    })
  }

  return (
    <PrototypeDialog
      open
      title={template && !duplicate ? '编辑 AGENTS.md 模板' : '新建 AGENTS.md 模板'}
      onClose={() => onOpenChange(false)}
    >
      <form
        id="template-form"
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <div className="form-grid">
          <ProtoField label="名称">
            <input name="name" value={name} maxLength={40} onChange={(event) => setName(event.target.value)} />
          </ProtoField>
          <ProtoField label="分类">
            <input name="tag" value={tag} maxLength={30} onChange={(event) => setTag(event.target.value)} />
          </ProtoField>
          <ProtoField label="说明" full>
            <input
              name="description"
              value={description}
              maxLength={200}
              onChange={(event) => setDescription(event.target.value)}
            />
          </ProtoField>
          <ProtoField label="AGENTS.md" full>
            <textarea
              name="content"
              className="document-editor"
              value={content}
              maxLength={20000}
              spellCheck={false}
              onChange={(event) => setContent(event.target.value)}
            />
          </ProtoField>
        </div>
        {template && !duplicate && (
          <p className="section-note">保存后，选用此模板的项目将使用新版本。需要独立维护时请先创建副本。</p>
        )}
        <p className="field-error" role="alert">
          {error}
        </p>
        <div className="form-actions">
          <ProtoButton onClick={() => onOpenChange(false)}>取消</ProtoButton>
          <ProtoButton variant="primary" type="submit">
            保存模板
          </ProtoButton>
        </div>
      </form>
    </PrototypeDialog>
  )
}

/**
 * 渲染能力中心的 AGENTS.md 模板页面，结构与原型 `templatesPage` 一致。
 * @returns 模板卡片、全文预览、复制下载与按项目选用；选用结果保存在浏览器本地。
 */
export function TemplatesPage() {
  const navigate = useNavigate()
  const { openMenu } = usePrototypeMenu()
  const { currentTeam, teamProjects, currentProject, currentRole, showToast } = usePrototype()
  const { data, updateData } = useCapabilityData(showToast)
  const [search, setSearch] = useState('')
  const [previewTemplateId, setPreviewTemplateId] = useState<string | null>(initialPreviewId)
  const [targetProjectId, setTargetProjectId] = useState(currentProject.id)
  const [formOpen, setFormOpen] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState<DemoAgentTemplate | null>(null)
  const [duplicating, setDuplicating] = useState(false)

  const readOnly = currentRole === '浏览者'
  const teamTemplates = data.templates.filter((template) => template.teamId === currentTeam.id)
  const keyword = search.trim().toLowerCase()
  const visibleTemplates = teamTemplates.filter(
    (template) => !keyword || `${template.name} ${template.tag}`.toLowerCase().includes(keyword),
  )
  const activeProject = teamProjects.find((project) => project.id === targetProjectId) ?? currentProject
  const previewTemplate = teamTemplates.find((template) => template.id === previewTemplateId) ?? null
  const selectedTemplateId = data.projectTemplates[activeProject.id] ?? teamTemplates[0]?.id ?? ''
  const previewSelected = previewTemplate ? selectedTemplateId === previewTemplate.id : false

  const openCreate = () => {
    if (readOnly) return
    setEditingTemplate(null)
    setDuplicating(false)
    setFormOpen(true)
  }

  const openEdit = (template: DemoAgentTemplate) => {
    if (readOnly) return
    setPreviewTemplateId(null)
    setEditingTemplate(template)
    setDuplicating(false)
    setFormOpen(true)
  }

  const openDuplicate = (template: DemoAgentTemplate) => {
    if (readOnly) return
    setPreviewTemplateId(null)
    setEditingTemplate(template)
    setDuplicating(true)
    setFormOpen(true)
  }

  const saveTemplate = (values: TemplateFormValues) => {
    if (readOnly) return
    if (teamTemplates.some((template) => template.name === values.name && template.id !== editingTemplate?.id)) {
      showToast('模板名称已存在，请换一个名称。')
      return
    }
    const editing = editingTemplate && !duplicating ? editingTemplate : null
    const templateId = editing?.id ?? createLocalId('template')
    if (editing) {
      updateData((current) => ({
        ...current,
        templates: current.templates.map((template) =>
          template.id === editing.id && template.teamId === editing.teamId
            ? { ...template, ...values, version: String(Number(template.version) + 1) }
            : template,
        ),
      }))
      showToast(`已保存「${values.name}」的新版本（本地演示）`)
    } else {
      const template: DemoAgentTemplate = {
        id: templateId,
        teamId: currentTeam.id,
        name: values.name,
        tag: values.tag,
        description: values.description,
        content: values.content,
        version: '1',
      }
      updateData((current) => ({ ...current, templates: [...current.templates, template] }))
      showToast(`已${duplicating ? '创建副本' : '新建模板'}「${template.name}」（本地演示）`)
    }
    setFormOpen(false)
    setEditingTemplate(null)
    setDuplicating(false)
    setPreviewTemplateId(templateId)
  }

  const applyTemplate = (template: DemoAgentTemplate) => {
    if (readOnly) return
    updateData((current) => ({
      ...current,
      projectTemplates: { ...current.projectTemplates, [activeProject.id]: template.id },
    }))
    showToast(`已为${activeProject.name}选用「${template.name}」（本地演示，不覆盖远端仓库文件）。`)
  }

  const copyTemplate = async (template: DemoAgentTemplate) => {
    const copied = await copyText(template.content)
    showToast(copied ? `已复制「${template.name}」正文` : '浏览器未允许自动复制，请手动选择内容。')
  }

  const downloadTemplate = (template: DemoAgentTemplate) => {
    downloadTextFile('AGENTS.md', template.content)
    showToast(`已生成「${template.name}」的 AGENTS.md 下载文件`)
  }

  const copyPreviewLink = async (template: DemoAgentTemplate) => {
    const url = `${window.location.origin}${window.location.pathname}?template=${encodeURIComponent(template.id)}`
    const copied = await copyText(url)
    showToast(copied ? '已复制预览链接（打开同一环境的原型即可预览）' : '浏览器未允许自动复制链接。')
  }

  const closeForm = (open: boolean) => {
    if (open) return
    setFormOpen(false)
    setEditingTemplate(null)
    setDuplicating(false)
  }

  return (
    <>
      <header className="page-head skills-header">
        <div className="row">
          <ProtoIconButton label="展开导航" icon="menu" className="mobile-menu" onClick={openMenu} />
          <h1 className="sr-only">AGENTS.md 模板</h1>
        </div>
        <div className="tabs" role="tablist" aria-label="Skills 内容">
          <button
            type="button"
            role="tab"
            className="tab"
            aria-selected={false}
            onClick={() => navigate('/prototype/capabilities/skills')}
          >
            技能库
          </button>
          <button type="button" role="tab" className="tab" aria-selected={true}>
            AGENTS.md 模板
          </button>
        </div>
      </header>

      <div className="catalog">
        <div className="template-toolbar">
          <label className="row small muted">
            目标项目
            <select
              className="btn"
              aria-label="模板目标项目"
              value={activeProject.id}
              onChange={(event) => setTargetProjectId(event.target.value)}
            >
              {teamProjects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
          <ProtoButton variant="primary" disabled={readOnly} onClick={openCreate}>
            <PrototypeIcon name="plus" />
            新建模板
          </ProtoButton>
        </div>

        <div className="filters">
          <label className="search template-search">
            <PrototypeIcon name="search" />
            <input
              aria-label="搜索模板"
              placeholder="搜索模板名称或分类"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
        </div>

        {visibleTemplates.length > 0 ? (
          <div className="template-grid">
            {visibleTemplates.map((template) => {
              const selected = selectedTemplateId === template.id
              return (
                <article key={template.id} className="template-card">
                  <div className="row">
                    <PrototypeIcon name="file" />
                    <span className="badge">{template.tag}</span>
                    <span className="spacer" />
                    {selected && <span className="badge blue">当前选用</span>}
                    {readOnly && <ProtoChip tone="warning">只读</ProtoChip>}
                  </div>
                  <button type="button" className="template-title" onClick={() => setPreviewTemplateId(template.id)}>
                    {template.name}
                  </button>
                  <p>{template.description}</p>
                  <pre>{template.content.split('\n').slice(0, 6).join('\n')}</pre>
                  <div className="template-tools">
                    <button
                      type="button"
                      onClick={() => {
                        void copyTemplate(template)
                      }}
                    >
                      复制内容
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        void copyPreviewLink(template)
                      }}
                    >
                      复制链接
                    </button>
                    <button type="button" onClick={() => downloadTemplate(template)}>
                      下载
                    </button>
                  </div>
                  <div className="row">
                    <span className="small quiet">v{template.version}</span>
                    <span className="spacer" />
                    <button type="button" className="text-btn" onClick={() => setPreviewTemplateId(template.id)}>
                      管理文件 <PrototypeIcon name="arrow" />
                    </button>
                  </div>
                </article>
              )
            })}
          </div>
        ) : (
          <ProtoEmpty
            icon="search"
            title="没有匹配的模板"
            description="换个关键词，或清除筛选后查看全部模板。"
            action={<ProtoButton onClick={() => setSearch('')}>清除筛选</ProtoButton>}
          />
        )}
      </div>

      {previewTemplate && (
        <PrototypeDialog open title={`${previewTemplate.name} · AGENTS.md`} onClose={() => setPreviewTemplateId(null)}>
          <div className="row">
            <span className="badge">v{previewTemplate.version}</span>
            <span className="small muted">{previewTemplate.tag}</span>
            <span className="spacer" />
            <button type="button" className="text-btn" disabled={readOnly} onClick={() => openEdit(previewTemplate)}>
              编辑
            </button>
            <button
              type="button"
              className="text-btn"
              disabled={readOnly}
              onClick={() => openDuplicate(previewTemplate)}
            >
              创建副本
            </button>
          </div>
          <div className="document-toolbar">
            <ProtoButton
              onClick={() => {
                void copyTemplate(previewTemplate)
              }}
            >
              复制内容
            </ProtoButton>
            <ProtoButton
              onClick={() => {
                void copyPreviewLink(previewTemplate)
              }}
            >
              复制预览链接
            </ProtoButton>
            <ProtoButton onClick={() => downloadTemplate(previewTemplate)}>下载 AGENTS.md</ProtoButton>
          </div>
          <pre className="skill-source document-preview">{previewTemplate.content}</pre>
          <p className="section-note">
            链接包含当前版本快照。本机预览链接仅能在可访问本机服务的环境打开，尚未发布到公网。
          </p>
          <div className="template-apply">
            <label className="field">
              目标项目
              <select
                aria-label="选用模板的项目"
                value={activeProject.id}
                onChange={(event) => setTargetProjectId(event.target.value)}
              >
                {teamProjects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </label>
            <ProtoButton
              variant="primary"
              disabled={readOnly || previewSelected}
              onClick={() => applyTemplate(previewTemplate)}
            >
              {previewSelected ? '项目已选用' : '应用到项目'}
            </ProtoButton>
          </div>
          <p className="small muted">用于项目 Bots 的协作约定，不覆盖远端仓库文件。</p>
        </PrototypeDialog>
      )}

      {formOpen && (
        <TemplateFormDialog
          template={editingTemplate}
          duplicate={duplicating}
          onSave={saveTemplate}
          onOpenChange={closeForm}
        />
      )}
    </>
  )
}
