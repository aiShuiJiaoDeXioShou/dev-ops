import { useEffect, useState } from 'react'
import {
  ProtoButton,
  ProtoEmpty,
  ProtoField,
  ProtoIconButton,
  ProtoSectionHeading,
} from '@/prototype/components/proto-controls'
import { ProtoChip, ProtoStatus } from '@/prototype/components/proto'
import { PrototypeDialog } from '@/prototype/components/prototype-dialog'
import { PrototypeIcon } from '@/prototype/icons/icon'
import { usePrototypeMenu } from '@/prototype/layout/prototype-shell'
import { usePrototype } from '@/prototype/data/store'
import {
  changeKinds,
  changePhaseOrder,
  createDemoIncident,
  demoChangePlans,
  demoEnvironments,
  demoIncidents,
  demoServices,
  demoWatchRules,
} from '@/prototype/data/operations'
import type {
  ChangeKind,
  ChangePhase,
  DemoChangePlan,
  DemoEnvironment,
  DemoIncident,
  DemoWatchRule,
} from '@/prototype/data/operations'
import type { DemoProject } from '@/prototype/data/types'

/** 运维页的子页签；与旧 HTML 原型的三个页签保持一致。 */
type OperationsTab = '运行概况' | '值守规则' | '变更记录'

/** 页签顺序，供受控按钮校验回调值。 */
const operationsTabs: OperationsTab[] = ['运行概况', '值守规则', '变更记录']

/** 变更阶段到可用动作的映射；已完成阶段只提供通知预览。 */
const changeActions: Partial<
  Record<ChangePhase, Array<{ next: ChangePhase; label: string; note: string; primary?: boolean }>>
> = {
  待确认: [{ next: '已批准', label: '确认此计划', note: '变更计划已确认', primary: true }],
  已批准: [{ next: '执行中', label: '演示执行', note: '变更计划开始演示执行', primary: true }],
  执行中: [
    { next: '待验证', label: '演示执行成功', note: '演示执行成功，等待核对', primary: true },
    { next: '失败', label: '演示执行失败', note: '演示执行失败，可核对状态后重试' },
  ],
  待验证: [
    { next: '已完成', label: '核对通过', note: '核对通过，变更已完成', primary: true },
    { next: '失败', label: '核对不通过', note: '核对不通过，可核对状态后重试' },
  ],
  失败: [{ next: '待确认', label: '核对执行状态后重试', note: '已重新打开计划，等待确认' }],
}

/**
 * 取变更阶段可执行的动作列表。
 * @param phase 当前阶段。
 * @returns 动作列表；已完成阶段返回空数组。
 */
function changeActionsFor(phase: ChangePhase) {
  return changeActions[phase] ?? []
}

/**
 * 生成变更阶段对应的原型标签色调。
 * @param phase 变更阶段。
 * @returns `.work-chip` 色调；普通阶段返回 undefined。
 */
function changePhaseTone(phase: ChangePhase) {
  if (phase === '已完成') return 'success' as const
  if (phase === '失败' || phase === '已批准') return 'warning' as const
  if (phase === '执行中' || phase === '待验证') return 'selected' as const
  return undefined
}

/**
 * 渲染单个服务卡片：环境、版本、健康状态与采集说明。
 * @param props.service 服务；props.readOnly 浏览者只读；props.onInspect 发起排查。
 * @returns 原型 `.service-card` 结构的服务卡片。
 */
function ServiceCard({
  service,
  readOnly,
  onInspect,
}: {
  service: (typeof demoServices)[number]
  readOnly: boolean
  onInspect: () => void
}) {
  return (
    <article className="service-card">
      <div className="row">
        <h3>{service.name}</h3>
        <ProtoChip>{service.environment}</ProtoChip>
        <span className="spacer" />
        <ProtoChip tone={service.health === '正常' ? 'success' : 'warning'}>{service.health}</ProtoChip>
      </div>
      <div className="service-version">{service.version}</div>
      <div className="row small quiet">
        <span>采集于 {service.collectedAt}</span>
        <span className="spacer" />
        <button type="button" className="text-btn" disabled={readOnly} onClick={onInspect}>
          发起排查
        </button>
      </div>
    </article>
  )
}

/**
 * 渲染异常处理对话框：状态、证据来源与处理链路。
 * @param props.incident 事件；props.projectName 所属项目名称。
 * @param props.onClose 关闭回调；props.onInspectTask 进入 Bot 排查的本地提示。
 * @returns 与原型 dialog 一致的异常处理对话框。
 */
function IncidentDetailDialog({
  incident,
  projectName,
  onClose,
  onInspectTask,
}: {
  incident: DemoIncident
  projectName: string
  onClose: () => void
  onInspectTask: () => void
}) {
  return (
    <PrototypeDialog open title={`异常处理 · ${incident.title}`} onClose={onClose}>
      <div className="row">
        <ProtoChip>{incident.environment}</ProtoChip>
        <ProtoStatus status={incident.status} />
        <span className="spacer" />
        <span className="small quiet">
          {projectName} · 聚合 {incident.count} 次 · {incident.occurredAt}
        </span>
      </div>
      <p>{incident.evidence}</p>
      <p className="small quiet">{incident.evidenceSource}</p>
      <ol className="incident-flow">
        <li>
          <strong>发现异常</strong>
          <span>
            {incident.environment} · 聚合 {incident.count} 次同类事件
          </span>
        </li>
        <li>
          <strong>建立问题</strong>
          <span>
            {incident.issueId || '未关联事项'} · 排查任务「{incident.taskTitle}」
          </span>
        </li>
        <li>
          <strong>Bot 排查与修复</strong>
          <span>{incident.assignee} · 任务状态与业务事项状态分别维护</span>
        </li>
        <li>
          <strong>发布并验证</strong>
          <span>验收后制定变更计划，验证运行版本与健康状态。</span>
        </li>
      </ol>
      <div className="form-actions">
        <ProtoButton variant="primary" onClick={onInspectTask}>
          进入 Bot 排查
        </ProtoButton>
        <ProtoButton onClick={onClose}>关闭</ProtoButton>
      </div>
    </PrototypeDialog>
  )
}

/**
 * 渲染变更计划详情对话框：属性、阶段进度与阶段动作。
 * @param props.plan 计划；props.projectName 项目名称；props.readOnly 浏览者只读。
 * @param props.onClose 关闭；props.onTransition 推进到下一阶段；props.onPreviewNotice 生成通知预览。
 * @returns 与原型 operationDetail 结构一致的变更详情对话框。
 */
function ChangePlanDialog({
  plan,
  projectName,
  readOnly,
  onClose,
  onTransition,
  onPreviewNotice,
}: {
  plan: DemoChangePlan
  projectName: string
  readOnly: boolean
  onClose: () => void
  onTransition: (next: ChangePhase, note: string) => void
  onPreviewNotice: () => void
}) {
  return (
    <PrototypeDialog open title={`${plan.kind} · ${plan.target}`} onClose={onClose}>
      <div className="row">
        <ProtoChip>{plan.environment}</ProtoChip>
        <ProtoChip tone={changePhaseTone(plan.phase)}>{plan.phase}</ProtoChip>
        <span className="spacer" />
        <span className="small quiet">本地演示</span>
      </div>
      <dl className="work-properties">
        <dt>项目</dt>
        <dd>{projectName}</dd>
        <dt>目标</dt>
        <dd>{plan.target}</dd>
        <dt>计划</dt>
        <dd>{plan.scope}</dd>
        <dt>版本 / 迁移</dt>
        <dd>{plan.version}</dd>
        <dt>核对依据</dt>
        <dd>{plan.evidence}</dd>
        <dt>恢复方案</dt>
        <dd>{plan.rollback}</dd>
        <dt>更新</dt>
        <dd>
          {plan.updatedAt} · 操作人 {plan.operator}
        </dd>
      </dl>
      <div className="operation-progress">
        {changePhaseOrder.map((phase) => (
          <ProtoChip key={phase} tone={phase === plan.phase ? 'selected' : undefined}>
            {phase}
          </ProtoChip>
        ))}
      </div>
      <p className="small muted">不连接服务器、不执行 SQL 或删除文件。以下按钮用于核对交互流程。</p>
      {plan.phase === '失败' && (
        <p className="small quiet">当前变更失败：请先核对执行状态与影响范围，再决定是否重试或关闭计划。</p>
      )}
      <div className="form-actions">
        {plan.phase === '已完成' && (
          <ProtoButton disabled={readOnly} onClick={onPreviewNotice}>
            生成飞书通知预览
          </ProtoButton>
        )}
        {changeActionsFor(plan.phase).map((action) => (
          <ProtoButton
            key={action.label}
            variant={action.primary ? 'primary' : 'default'}
            disabled={readOnly}
            onClick={() => onTransition(action.next, action.note)}
          >
            {action.label}
          </ProtoButton>
        ))}
        <ProtoButton onClick={onClose}>关闭</ProtoButton>
      </div>
    </PrototypeDialog>
  )
}

/**
 * 渲染新建变更计划表单对话框。
 * @param props.open 打开状态；props.onClose 关闭回调；props.projects 可选项目。
 * @param props.defaultProjectId 默认项目；props.readOnly 浏览者只读。
 * @param props.onCreate 创建回调，由页面写入本地计划列表。
 * @returns 环境、范围与恢复方案等字段完整的原型表单。
 */
function NewChangePlanDialog({
  open,
  onClose,
  projects,
  defaultProjectId,
  readOnly,
  onCreate,
}: {
  open: boolean
  onClose: () => void
  projects: DemoProject[]
  defaultProjectId: string
  readOnly: boolean
  onCreate: (plan: DemoChangePlan) => void
}) {
  const [projectId, setProjectId] = useState(defaultProjectId)
  const [kind, setKind] = useState<ChangeKind>('部署版本')
  const [environment, setEnvironment] = useState<DemoEnvironment>('测试')
  const [target, setTarget] = useState('API')
  const [version, setVersion] = useState('')
  const [scope, setScope] = useState('')
  const [evidence, setEvidence] = useState('')
  const [rollback, setRollback] = useState('')
  const [error, setError] = useState('')

  const submit = () => {
    if (readOnly) return
    if (!target.trim() || !scope.trim() || !rollback.trim()) {
      setError('请填写服务 / 资源、变更范围与恢复方案。')
      return
    }
    const now = new Date()
    onCreate({
      id: `op-${Date.now()}`,
      projectId,
      kind,
      target: target.trim(),
      environment,
      version: version.trim() || '未指定版本',
      scope: scope.trim(),
      evidence: evidence.trim() || '待补充核对依据',
      rollback: rollback.trim(),
      phase: '待确认',
      updatedAt: `今天 ${now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })}`,
      operator: '林然',
    })
    setError('')
    setVersion('')
    setScope('')
    setEvidence('')
    setRollback('')
  }

  return (
    <PrototypeDialog open={open} title="新建运维操作" onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <div className="form-grid">
          <ProtoField label="项目">
            <select
              aria-label="目标项目"
              value={projectId}
              disabled={readOnly}
              onChange={(event) => setProjectId(event.target.value)}
            >
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </ProtoField>
          <ProtoField label="目标环境">
            <select
              aria-label="目标环境"
              value={environment}
              disabled={readOnly}
              onChange={(event) => {
                const next = demoEnvironments.find((item) => item === event.target.value)
                if (next) setEnvironment(next)
              }}
            >
              {demoEnvironments.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </ProtoField>
          <ProtoField label="操作类型">
            <select
              aria-label="变更类型"
              value={kind}
              disabled={readOnly}
              onChange={(event) => {
                const next = changeKinds.find((item) => item === event.target.value)
                if (next) setKind(next)
              }}
            >
              {changeKinds.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </ProtoField>
          <ProtoField label="服务 / 资源">
            <input
              value={target}
              maxLength={100}
              placeholder="例如 API、project_member 表"
              disabled={readOnly}
              onChange={(event) => setTarget(event.target.value)}
            />
          </ProtoField>
          <ProtoField label="版本 / 迁移标识" full>
            <input
              value={version}
              maxLength={120}
              placeholder="例如 v0.5.3、migration-20261110"
              disabled={readOnly}
              onChange={(event) => setVersion(event.target.value)}
            />
          </ProtoField>
          <ProtoField label="变更计划与范围" full>
            <textarea
              value={scope}
              maxLength={2000}
              placeholder="说明具体范围；清理需列出目录、文件类型和保留期限，数据库变更需说明影响行数。"
              disabled={readOnly}
              onChange={(event) => setScope(event.target.value)}
            />
          </ProtoField>
          <ProtoField label="核对依据" full>
            <textarea
              value={evidence}
              maxLength={1000}
              placeholder="提交、测试结果或影响范围；无法提供时说明原因。"
              disabled={readOnly}
              onChange={(event) => setEvidence(event.target.value)}
            />
          </ProtoField>
          <ProtoField label="恢复方案" full>
            <textarea
              value={rollback}
              maxLength={1000}
              placeholder="旧版本、备份或补偿方案；不可回滚时说明处理办法。"
              disabled={readOnly}
              onChange={(event) => setRollback(event.target.value)}
            />
          </ProtoField>
        </div>
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions">
          <ProtoButton onClick={onClose}>取消</ProtoButton>
          <ProtoButton variant="primary" type="submit" disabled={readOnly}>
            保存计划
          </ProtoButton>
        </div>
      </form>
    </PrototypeDialog>
  )
}

/**
 * 渲染运维原型页：运行概况、值守规则与变更记录三个子页签。
 * @returns 与 HTML 原型 `.work-padding` 结构一致的运维页面；浏览者只读。
 * @remarks 事件聚合、规则启停与变更计划只写入页面本地状态，不连接服务器。
 */
export function OperationsPage() {
  const { data, teamProjects, currentProject, currentRole, showToast } = usePrototype()
  const { openMenu } = usePrototypeMenu()
  const readOnly = currentRole === '浏览者'
  const [activeTab, setActiveTab] = useState<OperationsTab>('运行概况')
  const [scope, setScope] = useState(currentProject.id)
  const [incidents, setIncidents] = useState<DemoIncident[]>(demoIncidents)
  const [rules, setRules] = useState<DemoWatchRule[]>(demoWatchRules)
  const [plans, setPlans] = useState<DemoChangePlan[]>(demoChangePlans)
  const [incidentDetailId, setIncidentDetailId] = useState<string | null>(null)
  const [planDetailId, setPlanDetailId] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)

  useEffect(() => {
    setScope(currentProject.id)
  }, [currentProject.id])

  const projectNameFor = (projectId: string) =>
    data.projects.find((project) => project.id === projectId)?.name ?? '未知项目'
  const projectServices = demoServices.filter((service) => service.projectId === scope)
  const projectIncidents = incidents.filter((incident) => incident.projectId === scope)
  const projectRules = rules.filter((rule) => rule.projectId === scope)
  const projectPlans = plans.filter((plan) => plan.projectId === scope)
  const incidentDetail = incidents.find((incident) => incident.id === incidentDetailId) ?? null
  const planDetail = plans.find((plan) => plan.id === planDetailId) ?? null

  const simulateIncident = (triggerLabel = '手动演示') => {
    if (readOnly) return
    const fingerprint = `${scope}:测试:AUTH_STALE`
    const activeIncident = incidents.find(
      (incident) => incident.fingerprint === fingerprint && incident.status !== '已解决',
    )
    if (activeIncident) {
      setIncidents((current) =>
        current.map((incident) =>
          incident.id === activeIncident.id
            ? { ...incident, count: incident.count + 1, occurredAt: '刚刚', status: '待处理' }
            : incident,
        ),
      )
      showToast(`同类异常已聚合（${triggerLabel}），累计 ${activeIncident.count + 1} 次（本地演示）`)
      return
    }
    const incident = createDemoIncident(scope)
    setIncidents((current) => [incident, ...current])
    setIncidentDetailId(incident.id)
    showToast(`已创建异常事件、排查任务与通知（${triggerLabel}，本地演示）`)
  }

  const toggleRule = (ruleId: string, enabled: boolean) => {
    if (readOnly) return
    setRules((current) => current.map((rule) => (rule.id === ruleId ? { ...rule, enabled } : rule)))
    showToast(enabled ? '值守规则已启用（本地演示）' : '值守规则已暂停（本地演示）')
  }

  const triggerRule = (rule: DemoWatchRule) => {
    if (readOnly) return
    if (!rule.enabled) {
      showToast('请先启用规则')
      return
    }
    if (!rule.botOnline) {
      showToast(`执行 Bot ${rule.botName} 离线，规则未触发（本地演示）`)
      return
    }
    setRules((current) => current.map((item) => (item.id === rule.id ? { ...item, lastTriggered: '刚刚' } : item)))
    if (rule.type === '日志告警') {
      simulateIncident(`${rule.name} 触发`)
      return
    }
    showToast(`已创建定时巡检核对任务（${rule.name}，本地演示）`)
  }

  const createPlan = (plan: DemoChangePlan) => {
    setPlans((current) => [plan, ...current])
    setCreateOpen(false)
    setActiveTab('变更记录')
    setPlanDetailId(plan.id)
    showToast('变更计划已创建，等待确认（本地演示）')
  }

  const transitionPlan = (planId: string, next: ChangePhase, note: string) => {
    if (readOnly) return
    setPlans((current) =>
      current.map((plan) => (plan.id === planId ? { ...plan, phase: next, updatedAt: '刚刚' } : plan)),
    )
    showToast(`${note}（本地演示）`)
  }

  return (
    <div className="work-padding operations-content">
      <h1 className="sr-only">运维</h1>
      <div className="row work-toolbar operations-toolbar">
        <ProtoIconButton label="展开导航" icon="menu" className="mobile-menu" onClick={openMenu} />
        <select className="btn" aria-label="运维项目" value={scope} onChange={(event) => setScope(event.target.value)}>
          {teamProjects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
        <span className="spacer" />
        <ProtoButton disabled={readOnly} onClick={() => setCreateOpen(true)}>
          新建运维操作
        </ProtoButton>
      </div>
      <div className="work-tabs" role="tablist" aria-label="运维视图">
        {operationsTabs.map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={activeTab === tab}
            className={activeTab === tab ? 'active' : undefined}
            onClick={() => setActiveTab(tab)}
          >
            {tab}
          </button>
        ))}
      </div>

      {activeTab === '运行概况' && (
        <>
          <div className="service-grid">
            {projectServices.map((service) => (
              <ServiceCard
                key={service.id}
                service={service}
                readOnly={readOnly}
                onInspect={() => showToast('已发起排查（本地演示），原型不连接服务器。')}
              />
            ))}
            {projectServices.length === 0 && (
              <ProtoEmpty title="没有接入服务" description="可先通过连接与节点配置数据来源。" />
            )}
          </div>
          <ProtoSectionHeading
            title="运行事件"
            actions={
              <ProtoButton disabled={readOnly} onClick={() => simulateIncident()}>
                演示一次日志异常
              </ProtoButton>
            }
          />
          {projectIncidents.map((incident) => (
            <article className="event-card" key={incident.id}>
              <div className="row">
                <strong>{incident.title}</strong>
                <ProtoChip>{incident.environment}</ProtoChip>
                <span className="spacer" />
                <span className="small quiet">
                  聚合 {incident.count} 次 · {incident.occurredAt}
                </span>
              </div>
              <p>{incident.evidence}</p>
              <ProtoButton onClick={() => setIncidentDetailId(incident.id)}>查看处理链路</ProtoButton>
              <button
                type="button"
                className="text-btn"
                onClick={() => showToast('原型不跳转协作会话；正式实现会打开对应排查任务。')}
              >
                进入 Bot 排查
              </button>
            </article>
          ))}
          {incidents.length === 0 && (
            <ProtoEmpty
              title="暂无告警事件"
              description="点击「演示一次日志异常」创建一条本地演示事件，并查看处理链路。"
            />
          )}
        </>
      )}

      {activeTab === '值守规则' && (
        <>
          <ProtoSectionHeading title="值守规则" />
          {projectRules.map((rule) => (
            <article className="rule-row" key={rule.id}>
              <span className="rule-symbol">
                <PrototypeIcon name="clock" />
              </span>
              <div>
                <strong>{rule.name}</strong>
                <p>
                  {rule.type} · {rule.frequency} · {rule.environment} · {rule.botName}
                  {rule.botOnline ? '' : '（离线）'}
                </p>
                <p>{rule.condition}</p>
                <small>最近触发：{rule.lastTriggered}</small>
              </div>
              <span className="spacer" />
              <ProtoButton
                className={rule.enabled ? 'blue' : undefined}
                disabled={readOnly}
                onClick={() => toggleRule(rule.id, !rule.enabled)}
              >
                {rule.enabled ? '已启用' : '已暂停'}
              </ProtoButton>
              <ProtoButton disabled={readOnly} onClick={() => triggerRule(rule)}>
                演示触发
              </ProtoButton>
            </article>
          ))}
          {rules.length === 0 && (
            <ProtoEmpty title="还没有值守规则" description="规则用于在日志异常或定时巡检时创建事件与排查任务。" />
          )}
        </>
      )}

      {activeTab === '变更记录' && (
        <>
          <ProtoSectionHeading
            title="变更记录"
            actions={
              <ProtoButton disabled={readOnly} onClick={() => setCreateOpen(true)}>
                新建运维操作
              </ProtoButton>
            }
          />
          {projectPlans.map((plan) => (
            <button type="button" className="work-task-row" key={plan.id} onClick={() => setPlanDetailId(plan.id)}>
              <span>
                <strong>
                  {plan.kind} · {plan.target}
                </strong>
                <small>
                  {plan.environment} · {plan.version} · {plan.updatedAt} · 操作人 {plan.operator}
                </small>
              </span>
              <ProtoChip tone={changePhaseTone(plan.phase)}>{plan.phase}</ProtoChip>
            </button>
          ))}
          {plans.length === 0 && (
            <ProtoEmpty
              title="还没有变更记录"
              description="创建变更计划后，按待确认、已批准、执行中、待验证与已完成推进。"
            />
          )}
          <p className="small quiet">变更流程：待确认 → 已批准 → 执行中 → 待验证 → 已完成；失败后可核对状态重试。</p>
        </>
      )}

      {incidentDetail && (
        <IncidentDetailDialog
          incident={incidentDetail}
          projectName={projectNameFor(incidentDetail.projectId)}
          onClose={() => setIncidentDetailId(null)}
          onInspectTask={() => showToast('原型不跳转协作会话；正式实现会打开对应排查任务。')}
        />
      )}

      {planDetail && (
        <ChangePlanDialog
          plan={planDetail}
          projectName={projectNameFor(planDetail.projectId)}
          readOnly={readOnly}
          onClose={() => setPlanDetailId(null)}
          onTransition={(next, note) => transitionPlan(planDetail.id, next, note)}
          onPreviewNotice={() => showToast('已生成本地飞书通知预览，原型不发送消息。')}
        />
      )}

      <NewChangePlanDialog
        key={`${createOpen ? 'open' : 'closed'}-${currentProject.id}`}
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        projects={teamProjects}
        defaultProjectId={currentProject.id}
        readOnly={readOnly}
        onCreate={createPlan}
      />
    </div>
  )
}
