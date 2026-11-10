import { useState } from 'react'
import { ProtoButton, ProtoField } from '@/prototype/components/proto-controls'
import { PrototypeDialog } from '@/prototype/components/prototype-dialog'
import { usePrototype } from '@/prototype/data/store'
import { demoMembers } from '@/prototype/data/seed'
import type { DemoItem } from '@/prototype/data/types'

interface ActionField {
  name: string
  label: string
  type: 'text' | 'textarea' | 'select'
  options?: string[]
  required?: boolean
  placeholder?: string
}

interface WorkflowAction {
  id: string
  label: string
  next: string
  primary?: boolean
  fields: ActionField[]
}

const reasonField: ActionField = {
  name: 'reason',
  label: '原因',
  type: 'textarea',
  required: true,
  placeholder: '说明本次操作的原因，记录会写入活动历史',
}

/**
 * 返回当前事项状态允许的 V0.1 业务动作。
 * @param item 当前需求或 Bug。
 * @returns 动作定义；只包含规格允许的下一步，不提供任意状态跳转。
 */
function actionsFor(item: DemoItem): WorkflowAction[] {
  if (item.kind === '需求') {
    switch (item.status) {
      case '待处理':
        return [
          { id: 'start-development', label: '开始开发', next: '开发中', primary: true, fields: [] },
          { id: 'cancel', label: '取消需求', next: '已取消', fields: [reasonField] },
        ]
      case '开发中':
        return [
          {
            id: 'submit-test',
            label: '提交测试',
            next: '待测试',
            primary: true,
            fields: [
              { name: 'tester', label: '测试负责人', type: 'select', options: [...demoMembers], required: true },
              {
                name: 'acceptance',
                label: '验收标准',
                type: 'textarea',
                required: true,
                placeholder: '描述本次验收的通过条件',
              },
              {
                name: 'scope',
                label: '测试范围说明',
                type: 'textarea',
                required: true,
                placeholder: '说明需要覆盖的路径和边界',
              },
              { name: 'selfTest', label: '自测结论', type: 'select', options: ['通过', '不通过'], required: true },
            ],
          },
          { id: 'cancel', label: '取消需求', next: '已取消', fields: [reasonField] },
        ]
      case '待测试':
        return [
          { id: 'start-test', label: '开始测试', next: '测试中', primary: true, fields: [] },
          { id: 'withdraw-test', label: '撤回开发', next: '开发中', fields: [{ ...reasonField, label: '撤回原因' }] },
          { id: 'cancel', label: '取消需求', next: '已取消', fields: [reasonField] },
        ]
      case '测试中':
        return [
          {
            id: 'pass-test',
            label: '测试通过',
            next: '测试通过',
            primary: true,
            fields: [
              {
                name: 'conclusion',
                label: '测试结论',
                type: 'textarea',
                required: true,
                placeholder: '记录本次测试结论；关联 Bug 必须均已解决或关闭',
              },
            ],
          },
          {
            id: 'return-development',
            label: '退回开发',
            next: '开发中',
            fields: [{ ...reasonField, label: '退回原因' }],
          },
          { id: 'cancel', label: '取消需求', next: '已取消', fields: [reasonField] },
        ]
      case '测试通过':
        return [
          {
            id: 'reopen-development',
            label: '重新开发',
            next: '开发中',
            fields: [{ ...reasonField, label: '重新开发原因' }],
          },
        ]
      case '已取消':
        return [{ id: 'restore', label: '恢复需求', next: '待处理', primary: true, fields: [] }]
      default:
        return []
    }
  }
  switch (item.status) {
    case '待处理':
      return [
        { id: 'start-fix', label: '开始修复', next: '修复中', primary: true, fields: [] },
        { id: 'close', label: '关闭 Bug', next: '已关闭', fields: [reasonField] },
      ]
    case '修复中':
      return [
        {
          id: 'submit-regression',
          label: '提交回归',
          next: '待回归',
          primary: true,
          fields: [
            {
              name: 'fixNote',
              label: '修复说明',
              type: 'textarea',
              required: true,
              placeholder: '说明修复内容、影响范围与验证方式',
            },
            { name: 'regressionOwner', label: '回归负责人', type: 'select', options: [...demoMembers], required: true },
          ],
        },
        { id: 'close', label: '关闭 Bug', next: '已关闭', fields: [reasonField] },
      ]
    case '待回归':
      return [
        {
          id: 'regression-pass',
          label: '回归通过',
          next: '已解决',
          primary: true,
          fields: [
            {
              name: 'conclusion',
              label: '回归结论',
              type: 'textarea',
              required: true,
              placeholder: '记录回归通过的证据与说明',
            },
          ],
        },
        { id: 'regression-fail', label: '回归失败', next: '修复中', fields: [{ ...reasonField, label: '失败原因' }] },
        {
          id: 'withdraw-regression',
          label: '撤回回归',
          next: '修复中',
          fields: [{ ...reasonField, label: '撤回原因' }],
        },
        { id: 'close', label: '关闭 Bug', next: '已关闭', fields: [reasonField] },
      ]
    case '已解决':
    case '已关闭':
      return [{ id: 'reopen', label: '重开 Bug', next: '待处理', fields: [{ ...reasonField, label: '重开原因' }] }]
    default:
      return []
  }
}

/**
 * 渲染 V0.1 事项业务动作按钮与表单弹窗。
 * @param props.item 当前需求或 Bug；props.readOnly 浏览者只读。
 * @returns 按状态机生成的动作按钮；测试通过前校验关联 Bug 阻碍项。
 */
export function ItemWorkflowActions({ item, readOnly }: { item: DemoItem; readOnly: boolean }) {
  const { data, updateItem, showToast } = usePrototype()
  const [active, setActive] = useState<WorkflowAction | null>(null)
  const [values, setValues] = useState<Record<string, string>>({})
  const [blockers, setBlockers] = useState<DemoItem[] | null>(null)
  const linkedBugs =
    item.kind === '需求'
      ? data.items.filter((candidate) => candidate.kind === 'Bug' && candidate.requirementId === item.id)
      : []
  const actions = actionsFor(item)

  const finish = (action: WorkflowAction, actionValues: Record<string, string>) => {
    const requiredMissing = action.fields.find((field) => field.required && !actionValues[field.name]?.trim())
    if (requiredMissing) {
      showToast(`请填写${requiredMissing.label}`)
      return
    }
    const summary =
      actionValues.reason ?? actionValues.conclusion ?? actionValues.fixNote ?? actionValues.acceptance ?? ''
    const time = new Date().toLocaleString('zh-CN')
    const patch: Partial<DemoItem> = {
      status: action.next,
      activity: [`林然 · ${time} · ${action.label}${summary ? `：${summary}` : ''}`, ...item.activity],
    }
    if (action.id === 'submit-test' && actionValues.tester) patch.tester = actionValues.tester
    updateItem(item.id, patch)
    setActive(null)
    setValues({})
    showToast(`${action.label}已记录（后续状态：${action.next}）`)
  }

  const trigger = (action: WorkflowAction) => {
    if (readOnly) return
    if (action.id === 'pass-test') {
      const unresolved = linkedBugs.filter((bug) => bug.status !== '已解决' && bug.status !== '已关闭')
      if (unresolved.length > 0) {
        setBlockers(unresolved)
        return
      }
    }
    if (action.fields.length === 0) {
      finish(action, {})
      return
    }
    setValues({})
    setActive(action)
  }

  return (
    <>
      <div className="task-actions">
        {actions.map((action) => (
          <ProtoButton
            key={action.id}
            variant={action.primary ? 'primary' : 'default'}
            disabled={readOnly}
            onClick={() => trigger(action)}
          >
            {action.label}
          </ProtoButton>
        ))}
        {item.kind === '需求' && linkedBugs.length > 0 && (
          <span className="small quiet">
            关联 Bug {linkedBugs.filter((bug) => bug.status !== '已解决' && bug.status !== '已关闭').length} 个未解决
          </span>
        )}
      </div>

      <PrototypeDialog open={active !== null} title={active?.label ?? '事项动作'} onClose={() => setActive(null)}>
        {active && (
          <>
            <p className="info-box">只更新本地业务状态并记录活动，不触发构建、部署、流水线或外部消息。</p>
            <div className="form-grid">
              {active.fields.map((field) => (
                <ProtoField key={field.name} label={field.label} full={field.type === 'textarea'}>
                  {field.type === 'select' ? (
                    <select
                      value={values[field.name] ?? ''}
                      onChange={(event) => setValues({ ...values, [field.name]: event.target.value })}
                    >
                      <option value="">请选择</option>
                      {field.options?.map((option) => (
                        <option key={option}>{option}</option>
                      ))}
                    </select>
                  ) : field.type === 'textarea' ? (
                    <textarea
                      value={values[field.name] ?? ''}
                      placeholder={field.placeholder}
                      onChange={(event) => setValues({ ...values, [field.name]: event.target.value })}
                    />
                  ) : (
                    <input
                      value={values[field.name] ?? ''}
                      placeholder={field.placeholder}
                      onChange={(event) => setValues({ ...values, [field.name]: event.target.value })}
                    />
                  )}
                </ProtoField>
              ))}
            </div>
            <div className="form-actions">
              <ProtoButton onClick={() => setActive(null)}>取消</ProtoButton>
              <ProtoButton variant="primary" onClick={() => finish(active, values)}>
                {active.label}
              </ProtoButton>
            </div>
          </>
        )}
      </PrototypeDialog>

      <PrototypeDialog open={blockers !== null} title="存在阻碍项" onClose={() => setBlockers(null)}>
        <p>需求测试通过前，关联 Bug 必须全部为已解决或已关闭。</p>
        <div className="work-checks">
          {blockers?.map((bug) => (
            <div key={bug.id} className="row">
              <span className="badge">{bug.id}</span>
              <span>{bug.title}</span>
              <span className="spacer" />
              <span className="status">
                <span className="dot amber" />
                {bug.status}
              </span>
            </div>
          ))}
        </div>
        <div className="form-actions">
          <ProtoButton variant="primary" onClick={() => setBlockers(null)}>
            知道了
          </ProtoButton>
        </div>
      </PrototypeDialog>
    </>
  )
}
