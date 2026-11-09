import { useState } from 'react'
import { PrototypeDialog } from '@/prototype/components/prototype-dialog'
import { BotAvatar } from '@/prototype/components/avatar'
import { ProtoButton, ProtoEmpty, ProtoField, ProtoWorkPageHead } from '@/prototype/components/proto-controls'
import { ProtoChip } from '@/prototype/components/proto'
import { PrototypeIcon } from '@/prototype/icons/icon'
import { usePrototype } from '@/prototype/data/store'
import { createLocalId, currentTimestamp, useCapabilityData } from '@/prototype/data/capabilities'
import type { DemoBot, DemoMemory } from '@/prototype/data/capabilities'

/** 记忆表单的提交值。 */
interface MemoryFormValues {
  botId: string
  text: string
  source: string
}

/**
 * 渲染新增或编辑项目记忆的表单对话框，结构与原型记忆表单一致。
 * @param props.memory 待编辑记忆；为空时表示新增。
 * @param props.bots 当前团队智能体，可作为记忆归属。
 * @param props.onSave 校验通过后的保存回调。
 * @param props.onOpenChange 关闭对话框的回调。
 * @returns 原型 `.form-grid`/`.field` 结构的记忆表单。
 */
function MemoryFormDialog({
  memory,
  bots,
  onSave,
  onOpenChange,
}: {
  memory: DemoMemory | null
  bots: DemoBot[]
  onSave: (values: MemoryFormValues) => void
  onOpenChange: (open: boolean) => void
}) {
  const [botId, setBotId] = useState(memory?.botId ?? '')
  const [text, setText] = useState(memory?.text ?? '')
  const [source, setSource] = useState(memory?.source ?? '团队确认')
  const [error, setError] = useState('')

  const submit = () => {
    if (!text.trim() || !source.trim()) {
      setError('请填写长期约定和来源。')
      return
    }
    onSave({ botId, text: text.trim(), source: source.trim() })
  }

  return (
    <PrototypeDialog open title={memory ? '编辑记忆' : '新增项目记忆'} onClose={() => onOpenChange(false)}>
      <p className="info-box">记忆保存长期约定；运行版本与任务状态仍以对应记录为准，不要写入密钥。</p>
      <form
        id="memory-form"
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <div className="form-grid">
          <ProtoField label="适用 Bot">
            <select name="bot" value={botId} onChange={(event) => setBotId(event.target.value)}>
              <option value="">团队共识</option>
              {bots.map((bot) => (
                <option key={bot.id} value={bot.id}>
                  {bot.name} · {bot.role}
                </option>
              ))}
            </select>
          </ProtoField>
          <ProtoField label="长期约定">
            <textarea
              name="text"
              value={text}
              maxLength={2000}
              placeholder="例如：权限修复需要覆盖登录后首次请求与 token 刷新两种场景。"
              onChange={(event) => setText(event.target.value)}
            />
          </ProtoField>
          <ProtoField label="来源">
            <input name="source" value={source} maxLength={200} onChange={(event) => setSource(event.target.value)} />
          </ProtoField>
        </div>
        <p className="field-error" role="alert">
          {error}
        </p>
        <div className="form-actions">
          <ProtoButton onClick={() => onOpenChange(false)}>取消</ProtoButton>
          <ProtoButton variant="primary" type="submit">
            {memory ? '保存修改' : '新增记忆'}
          </ProtoButton>
        </div>
      </form>
    </PrototypeDialog>
  )
}

/**
 * 渲染能力中心的项目记忆页面，结构与原型 `memories` 一致。
 * @returns 项目选择、记忆卡片、新增/编辑、确认与删除交互；数据保存在浏览器本地。
 */
export function MemoryPage() {
  const { currentTeam, teamProjects, currentProject, currentRole, showToast } = usePrototype()
  const { data, updateData } = useCapabilityData(showToast)
  const [selectedProjectId, setSelectedProjectId] = useState(currentProject.id)
  const [formOpen, setFormOpen] = useState(false)
  const [editingMemory, setEditingMemory] = useState<DemoMemory | null>(null)
  const [deletingMemory, setDeletingMemory] = useState<DemoMemory | null>(null)

  const readOnly = currentRole === '浏览者'
  const activeProject = teamProjects.find((project) => project.id === selectedProjectId) ?? currentProject
  const teamBots = data.bots.filter((bot) => bot.teamId === currentTeam.id)
  const projectMemories = data.memories.filter(
    (memory) => memory.teamId === currentTeam.id && memory.projectId === activeProject.id,
  )

  const botNameOf = (botId: string): string => {
    if (!botId) return '团队'
    return teamBots.find((bot) => bot.id === botId)?.name ?? '已移除的智能体'
  }

  const openCreate = () => {
    if (readOnly) return
    setEditingMemory(null)
    setFormOpen(true)
  }

  const openEdit = (memory: DemoMemory) => {
    if (readOnly) return
    setEditingMemory(memory)
    setFormOpen(true)
  }

  const saveMemory = (values: MemoryFormValues) => {
    if (editingMemory) {
      updateData((current) => ({
        ...current,
        memories: current.memories.map((memory) =>
          memory.id === editingMemory.id && memory.teamId === editingMemory.teamId
            ? {
                ...memory,
                botId: values.botId,
                text: values.text,
                source: values.source,
                confirmed: true,
                updated: currentTimestamp(),
              }
            : memory,
        ),
      }))
      showToast('记忆已更新并标记为已确认（本地演示）')
    } else {
      const memory: DemoMemory = {
        id: createLocalId('memory'),
        teamId: currentTeam.id,
        projectId: activeProject.id,
        botId: values.botId,
        text: values.text,
        source: values.source,
        confirmed: true,
        updated: currentTimestamp(),
      }
      updateData((current) => ({ ...current, memories: [memory, ...current.memories] }))
      showToast(`已为${activeProject.name}新增记忆（本地演示）`)
    }
    setFormOpen(false)
    setEditingMemory(null)
  }

  const confirmMemory = (memory: DemoMemory) => {
    if (readOnly) return
    updateData((current) => ({
      ...current,
      memories: current.memories.map((item) =>
        item.id === memory.id && item.teamId === memory.teamId
          ? { ...item, confirmed: true, updated: currentTimestamp() }
          : item,
      ),
    }))
    showToast('记忆已确认（本地演示）')
  }

  const removeMemory = () => {
    if (readOnly || !deletingMemory) return
    updateData((current) => ({
      ...current,
      memories: current.memories.filter(
        (memory) => !(memory.id === deletingMemory.id && memory.teamId === deletingMemory.teamId),
      ),
    }))
    showToast('记忆已删除；历史任务记录保留。')
    setDeletingMemory(null)
  }

  return (
    <>
      <ProtoWorkPageHead
        title="团队记忆"
        actions={
          <ProtoButton disabled={readOnly} onClick={openCreate}>
            <PrototypeIcon name="plus" />
            新增记忆
          </ProtoButton>
        }
      />

      <div className="work-padding">
        <div className="work-toolbar">
          <select
            className="btn"
            aria-label="记忆项目"
            value={activeProject.id}
            onChange={(event) => setSelectedProjectId(event.target.value)}
          >
            {teamProjects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </div>

        {projectMemories.map((memory) => (
          <article key={memory.id} className="memory-card">
            <div className="row">
              <BotAvatar name={botNameOf(memory.botId)} size="sm" />
              <strong>{botNameOf(memory.botId)}</strong>
              <ProtoChip tone={memory.confirmed ? 'success' : 'warning'}>
                {memory.confirmed ? '已确认' : '待确认'}
              </ProtoChip>
              <span className="spacer" />
              <button type="button" className="text-btn" disabled={readOnly} onClick={() => openEdit(memory)}>
                编辑
              </button>
              {!memory.confirmed && (
                <button type="button" className="text-btn" disabled={readOnly} onClick={() => confirmMemory(memory)}>
                  确认
                </button>
              )}
              <button type="button" className="text-btn" disabled={readOnly} onClick={() => setDeletingMemory(memory)}>
                删除
              </button>
            </div>
            <p>{memory.text}</p>
            <small>
              来源：{memory.source || '未标注'} · {memory.updated}
            </small>
          </article>
        ))}

        {projectMemories.length === 0 && (
          <ProtoEmpty
            icon="sparkle"
            title="没有项目记忆"
            description="把项目的长期约定记录为记忆；运行版本与任务状态仍以对应记录为准。"
            action={
              readOnly ? (
                <ProtoChip tone="warning">浏览者只读</ProtoChip>
              ) : (
                <ProtoButton onClick={openCreate}>
                  <PrototypeIcon name="plus" />
                  新增记忆
                </ProtoButton>
              )
            }
          />
        )}

        <p className="small quiet">记忆保存长期约定；运行版本和任务状态从对应记录读取。</p>
      </div>

      {formOpen && (
        <MemoryFormDialog
          memory={editingMemory}
          bots={teamBots}
          onSave={saveMemory}
          onOpenChange={(open) => {
            if (!open) {
              setFormOpen(false)
              setEditingMemory(null)
            }
          }}
        />
      )}

      {deletingMemory && (
        <PrototypeDialog open title="删除记忆" onClose={() => setDeletingMemory(null)}>
          <p>删除后不再作为项目约定提供，历史任务记录会保留。</p>
          <div className="form-actions">
            <ProtoButton onClick={() => setDeletingMemory(null)}>取消</ProtoButton>
            <ProtoButton variant="primary" disabled={readOnly} onClick={removeMemory}>
              确认删除
            </ProtoButton>
          </div>
        </PrototypeDialog>
      )}
    </>
  )
}
