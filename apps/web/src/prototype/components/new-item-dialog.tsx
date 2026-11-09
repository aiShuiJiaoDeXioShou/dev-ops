import { useState } from 'react'
import { PrototypeDialog } from '@/prototype/components/prototype-dialog'
import { ProtoField } from '@/prototype/components/proto-controls'
import { usePrototype } from '@/prototype/data/store'
import { demoMembers } from '@/prototype/data/seed'
import type { DemoItem } from '@/prototype/data/types'

/**
 * 计算项目内下一个事项编号。
 * @param items 当前事项；kind 事项类型。
 * @returns 形如 PRD-032 / BUG-019 的编号。
 */
function nextItemId(items: DemoItem[], kind: DemoItem['kind']) {
  const prefix = kind === '需求' ? 'PRD' : 'BUG'
  const maximum = items
    .filter((item) => item.kind === kind)
    .reduce((max, item) => Math.max(max, Number(item.id.split('-')[1] ?? 0)), 0)
  return `${prefix}-${String(maximum + 1).padStart(3, '0')}`
}

/**
 * 渲染与原型 newItem 表单一致的创建事项对话框。
 * @param props.kind 默认事项类型；props.open 打开状态；props.onOpenChange 状态回调。
 * @returns 原生 dialog 表单；只写入本地演示数据。
 */
export function NewItemDialog({
  kind,
  open,
  onOpenChange,
}: {
  kind: DemoItem['kind']
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { data, currentProject, currentRole, addItem, showToast } = usePrototype()
  const [form, setForm] = useState({
    kind,
    owner: '林然',
    title: '',
    description: '',
    collaborators: '未指定',
    external: '',
    contentMode: '内置正文' as '内置正文' | '外部文档链接',
    requirementId: '',
  })
  const [error, setError] = useState('')

  const submit = () => {
    if (currentRole === '浏览者') return
    if (!form.title.trim()) {
      setError('请填写标题。')
      return
    }
    if (form.contentMode === '内置正文' && !form.description.trim()) {
      setError('选择内置正文时必须填写需求或问题说明。')
      return
    }
    if (form.contentMode === '外部文档链接' && !/^https?:\/\//i.test(form.external.trim())) {
      setError('选择外部文档链接时必须填写 http:// 或 https:// 地址。')
      return
    }
    const item: DemoItem = {
      id: nextItemId(data.items, form.kind),
      projectId: currentProject.id,
      kind: form.kind,
      title: form.title.trim(),
      owner: form.owner,
      collaborators: form.collaborators === '未指定' ? '' : form.collaborators,
      tester: '',
      status: '待处理',
      pr: '',
      description: form.contentMode === '内置正文' ? form.description.trim() : `外部文档：${form.external.trim()}`,
      branch: 'main',
      external: form.contentMode === '外部文档链接' ? form.external.trim() : '',
      requirementId: form.kind === 'Bug' && form.requirementId ? form.requirementId : undefined,
      comments: [],
      activity: [`林然 · ${new Date().toLocaleString('zh-CN')} · 创建${form.kind}`],
    }
    addItem(item)
    showToast(`${form.kind} ${item.id} 已创建（本地演示）`)
    setForm({
      kind,
      owner: '林然',
      title: '',
      description: '',
      collaborators: '未指定',
      external: '',
      contentMode: '内置正文',
      requirementId: '',
    })
    setError('')
    onOpenChange(false)
  }

  return (
    <PrototypeDialog open={open} title="新建事项" onClose={() => onOpenChange(false)}>
      <div className="form-grid">
        <ProtoField label="类型">
          <select
            value={form.kind}
            onChange={(event) => setForm({ ...form, kind: event.target.value as DemoItem['kind'] })}
          >
            <option>需求</option>
            <option>Bug</option>
          </select>
        </ProtoField>
        <ProtoField label="研发负责人">
          <select value={form.owner} onChange={(event) => setForm({ ...form, owner: event.target.value })}>
            {demoMembers.map((member) => (
              <option key={member}>{member}</option>
            ))}
          </select>
        </ProtoField>
        <ProtoField label="标题" full>
          <input
            value={form.title}
            required
            maxLength={80}
            placeholder="简洁描述需要完成的事情"
            onChange={(event) => setForm({ ...form, title: event.target.value })}
          />
        </ProtoField>
        <ProtoField label="内容方式">
          <select
            value={form.contentMode}
            onChange={(event) => setForm({ ...form, contentMode: event.target.value as '内置正文' | '外部文档链接' })}
          >
            <option>内置正文</option>
            <option>外部文档链接</option>
          </select>
        </ProtoField>
        {form.kind === 'Bug' && (
          <ProtoField label="关联需求">
            <select
              value={form.requirementId}
              onChange={(event) => setForm({ ...form, requirementId: event.target.value })}
            >
              <option value="">不关联</option>
              {data.items
                .filter((item) => item.kind === '需求' && item.projectId === currentProject.id)
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.id} · {item.title}
                  </option>
                ))}
            </select>
          </ProtoField>
        )}
        {form.contentMode === '内置正文' ? (
          <ProtoField label="需求或问题说明" full>
            <textarea
              value={form.description}
              required
              maxLength={3000}
              placeholder="背景、目标与验收标准"
              onChange={(event) => setForm({ ...form, description: event.target.value })}
            />
          </ProtoField>
        ) : (
          <ProtoField label="外部文档链接" full>
            <input
              type="url"
              value={form.external}
              placeholder="https://…"
              onChange={(event) => setForm({ ...form, external: event.target.value })}
            />
          </ProtoField>
        )}
        <ProtoField label="协作成员">
          <select
            value={form.collaborators}
            onChange={(event) => setForm({ ...form, collaborators: event.target.value })}
          >
            <option>未指定</option>
            {demoMembers.map((member) => (
              <option key={member}>{member}</option>
            ))}
          </select>
        </ProtoField>
      </div>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      <div className="form-actions">
        <button type="button" className="btn" onClick={() => onOpenChange(false)}>
          取消
        </button>
        <button type="button" className="btn primary" disabled={currentRole === '浏览者'} onClick={submit}>
          创建事项
        </button>
      </div>
    </PrototypeDialog>
  )
}
