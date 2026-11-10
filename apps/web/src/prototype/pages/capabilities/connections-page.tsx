import { useState } from 'react'
import { useNavigate } from 'react-router'
import { PrototypeDialog } from '@/prototype/components/prototype-dialog'
import { ProtoButton, ProtoEmpty, ProtoField, ProtoIconButton } from '@/prototype/components/proto-controls'
import { ProtoChip } from '@/prototype/components/proto'
import { PrototypeIcon } from '@/prototype/icons/icon'
import { usePrototypeMenu } from '@/prototype/layout/prototype-shell'
import { usePrototype } from '@/prototype/data/store'
import { botRuntimes, useCapabilityData } from '@/prototype/data/capabilities'
import type { BotRuntime, DemoBot, DemoConnection } from '@/prototype/data/capabilities'

/** 按运行环境聚合的执行节点展示信息。 */
interface ExecutionNode {
  runtime: BotRuntime
  bots: DemoBot[]
  online: boolean
  assigned: boolean
}

/** 连接配置表单的提交值；只包含地址与凭据引用名称。 */
interface ConnectionFormValues {
  endpoint: string
  secretRef: string
}

/**
 * 渲染外部连接配置对话框，结构对齐原型连接表单。
 * @param props.connection 待配置连接。
 * @param props.onSave 校验通过后的保存回调。
 * @param props.onOpenChange 关闭对话框的回调。
 * @param props.onManageSecrets 跳转团队凭据库管理引用。
 * @returns 原型 `.field`/`.form-actions` 结构的连接配置表单。
 */
function ConnectionFormDialog({
  connection,
  onSave,
  onOpenChange,
  onManageSecrets,
}: {
  connection: DemoConnection
  onSave: (values: ConnectionFormValues) => void
  onOpenChange: (open: boolean) => void
  onManageSecrets: () => void
}) {
  const [endpoint, setEndpoint] = useState(connection.endpoint)
  const [secretRef, setSecretRef] = useState(connection.secretRef)
  const [error, setError] = useState('')

  const submit = () => {
    const trimmedEndpoint = endpoint.trim()
    const trimmedSecretRef = secretRef.trim()
    if (!trimmedEndpoint) {
      setError('请填写连接地址或角色标识。')
      return
    }
    if (/(?:password|token|secret|key)\s*=|https?:\/\/[^/]*@/i.test(trimmedEndpoint)) {
      setError('地址不能包含凭据，请只填写地址并使用凭据引用名称。')
      return
    }
    if (trimmedSecretRef && !/^[A-Z_][A-Z0-9_]*$/.test(trimmedSecretRef)) {
      setError('凭据引用名称只允许大写字母、数字和下划线，且不能以数字开头。')
      return
    }
    onSave({ endpoint: trimmedEndpoint, secretRef: trimmedSecretRef })
  }

  return (
    <PrototypeDialog open title={`配置 ${connection.name}`} onClose={() => onOpenChange(false)}>
      <form
        id="connection-form"
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <ProtoField label="连接地址 / 角色标识">
          <input
            name="endpoint"
            value={endpoint}
            maxLength={200}
            placeholder="地址中不要包含凭据"
            onChange={(event) => setEndpoint(event.target.value)}
          />
        </ProtoField>
        <ProtoField label="凭据引用名称">
          <input
            name="secret"
            value={secretRef}
            maxLength={80}
            placeholder="例如 ALIYUN_ROLE_TOKEN"
            onChange={(event) => setSecretRef(event.target.value)}
          />
        </ProtoField>
        <p className="small muted">仅保存连接配置，不在原型中连接外部服务。</p>
        <div className="work-gap">
          <button type="button" className="text-btn" onClick={onManageSecrets}>
            管理凭据配置
          </button>
        </div>
        <p className="field-error" role="alert">
          {error}
        </p>
        <div className="form-actions">
          <ProtoButton onClick={() => onOpenChange(false)}>取消</ProtoButton>
          <ProtoButton variant="primary" type="submit">
            保存配置
          </ProtoButton>
        </div>
      </form>
    </PrototypeDialog>
  )
}

/**
 * 渲染能力中心的连接与节点页面，结构与原型 `connections` 一致。
 * @returns 外部连接卡片、执行节点在线切换与凭据边界说明；数据保存在浏览器本地。
 */
export function ConnectionsPage() {
  const navigate = useNavigate()
  const { openMenu } = usePrototypeMenu()
  const { currentTeam, currentRole, showToast } = usePrototype()
  const { data, updateData } = useCapabilityData(showToast)
  const [editingConnection, setEditingConnection] = useState<DemoConnection | null>(null)

  const readOnly = currentRole === '浏览者'
  const teamBots = data.bots.filter((bot) => bot.teamId === currentTeam.id)
  const teamConnections = data.connections.filter((connection) => connection.teamId === currentTeam.id)
  const nodes: ExecutionNode[] = botRuntimes.map((runtime) => {
    const bots = teamBots.filter((bot) => bot.runtime === runtime)
    return { runtime, bots, online: bots.length > 0 && bots.every((bot) => bot.online), assigned: bots.length > 0 }
  })

  const saveConnection = (values: ConnectionFormValues) => {
    if (readOnly || !editingConnection) return
    updateData((current) => ({
      ...current,
      connections: current.connections.map((connection) =>
        connection.id === editingConnection.id && connection.teamId === editingConnection.teamId
          ? {
              ...connection,
              endpoint: values.endpoint,
              secretRef: values.secretRef,
              status: values.secretRef ? '已配置 · 未连接' : '待配置',
            }
          : connection,
      ),
    }))
    showToast(
      values.secretRef
        ? '连接配置已保存，状态为「已配置 · 未连接」；原型未连接外部服务。'
        : '连接配置已保存，等待补充凭据引用名称。',
    )
    setEditingConnection(null)
  }

  const toggleNode = (node: ExecutionNode) => {
    if (readOnly || !node.assigned) return
    const nextOnline = !node.online
    updateData((current) => ({
      ...current,
      bots: current.bots.map((bot) =>
        bot.teamId === currentTeam.id && bot.runtime === node.runtime ? { ...bot, online: nextOnline } : bot,
      ),
    }))
    showToast(`${node.runtime} 已模拟${nextOnline ? '恢复在线' : '离线'}；相关智能体状态随之更新。`)
  }

  return (
    <>
      <header className="work-page-head compact-page-head without-tools">
        <ProtoIconButton label="展开导航" icon="menu" className="mobile-menu" onClick={openMenu} />
        <h1 className="sr-only">连接与节点</h1>
      </header>

      <div className="work-padding">
        <h2>外部连接</h2>
        {teamConnections.length > 0 ? (
          <div className="connection-grid">
            {teamConnections.map((connection) => (
              <article key={connection.id} className="connection-card">
                <div className="row">
                  <h3>{connection.name}</h3>
                  <span className="spacer" />
                  <ProtoChip>{connection.status}</ProtoChip>
                </div>
                <p>
                  {connection.kind} · {connection.endpoint || '尚未配置'}
                </p>
                <ProtoButton disabled={readOnly} onClick={() => setEditingConnection(connection)}>
                  配置连接
                </ProtoButton>
              </article>
            ))}
          </div>
        ) : (
          <ProtoEmpty
            icon="link"
            title="还没有外部连接"
            description="配置连接后可关联代码平台或通知渠道；原型不会真正发起连接。"
          />
        )}

        <h2 className="work-gap">执行节点</h2>
        {nodes.map((node) => (
          <div key={node.runtime} className="rule-row">
            <div>
              <strong>{node.runtime}</strong>
              <p>{node.assigned ? node.bots.map((bot) => bot.name).join('、') : '尚未分配智能体'}</p>
            </div>
            <span className="spacer" />
            <ProtoChip>{node.assigned ? (node.online ? '示例在线' : '示例离线') : '未分配'}</ProtoChip>
            <ProtoButton disabled={readOnly || !node.assigned} onClick={() => toggleNode(node)}>
              {node.online ? '模拟离线' : '模拟恢复'}
            </ProtoButton>
          </div>
        ))}

        <div className="vault-note">
          <PrototypeIcon name="lock" />
          <span>连接配置只保存地址和引用名称，实际凭据在环境变量与密钥中管理。此原型不会验证或连接外部服务。</span>
        </div>
      </div>

      {editingConnection && (
        <ConnectionFormDialog
          connection={editingConnection}
          onSave={saveConnection}
          onOpenChange={(open) => {
            if (!open) setEditingConnection(null)
          }}
          onManageSecrets={() => {
            setEditingConnection(null)
            navigate('/prototype/vault')
          }}
        />
      )}
    </>
  )
}
