import { useEffect, useState } from 'react'
import { PrototypeDialog } from '@/prototype/components/prototype-dialog'
import { ProtoButton, ProtoEmpty, ProtoField, ProtoSectionHeading } from '@/prototype/components/proto-controls'
import { ProtoChip } from '@/prototype/components/proto'
import { PrototypeIcon } from '@/prototype/icons/icon'
import { usePrototype } from '@/prototype/data/store'
import { environmentVariables } from '@/prototype/data/project-detail'
import type { DemoEnvironmentVariable } from '@/prototype/data/project-detail'

const environments = ['开发', '测试', '生产'] as const

/**
 * 渲染原型的项目环境变量页，配置普通变量与密钥引用。
 * @returns 与 variables 结构和类名一致的页面；不保存真实密钥。
 */
export function EnvironmentPage() {
  const { currentProject, currentRole, showToast } = usePrototype()
  const [environment, setEnvironment] = useState<(typeof environments)[number]>('开发')
  const [variables, setVariables] = useState<DemoEnvironmentVariable[]>(() =>
    environmentVariables.filter((item) => item.projectId === currentProject.id),
  )
  const [editing, setEditing] = useState<DemoEnvironmentVariable | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [logOpen, setLogOpen] = useState(false)
  const [form, setForm] = useState({
    name: '',
    type: '普通变量' as DemoEnvironmentVariable['type'],
    value: '',
    auth: '运行时注入' as DemoEnvironmentVariable['auth'],
  })

  useEffect(() => {
    setVariables(environmentVariables.filter((item) => item.projectId === currentProject.id))
    setEnvironment('开发')
  }, [currentProject.id])

  const visible = variables.filter((item) => item.environment === environment)
  const readOnly = currentRole === '浏览者'

  const openCreate = () => {
    setEditing(null)
    setForm({ name: '', type: '普通变量', value: '', auth: '运行时注入' })
    setFormOpen(true)
  }

  const save = () => {
    if (!form.name.trim()) {
      showToast('请填写变量名称')
      return
    }
    if (editing) {
      setVariables((current) =>
        current.map((item) =>
          item.id === editing.id
            ? {
                ...item,
                name: form.name.trim(),
                type: form.type,
                auth: form.auth,
                version: item.version + 1,
                updatedAt: new Date().toLocaleString('zh-CN'),
              }
            : item,
        ),
      )
    } else {
      setVariables((current) => [
        ...current,
        {
          id: `env-${Date.now()}`,
          projectId: currentProject.id,
          environment,
          name: form.name.trim(),
          type: form.type,
          value: form.type === '密钥' ? '' : form.value,
          version: 1,
          auth: form.auth,
          bots: [],
          updatedAt: new Date().toLocaleString('zh-CN'),
        },
      ])
    }
    showToast('变量已保存；原型不保存真实值')
    setFormOpen(false)
    setEditing(null)
  }

  return (
    <>
      <ProtoSectionHeading
        title="环境变量与密钥"
        actions={
          <>
            <ProtoButton onClick={() => showToast('团队凭据库在全局导航中查看')}>团队凭据库</ProtoButton>
            <ProtoButton variant="primary" disabled={readOnly} onClick={openCreate}>
              <PrototypeIcon name="plus" />
              新增配置
            </ProtoButton>
          </>
        }
      />
      <div className="row work-toolbar">
        <div className="segments">
          {environments.map((value) => (
            <button
              key={value}
              type="button"
              className={`segment ${environment === value ? 'active' : ''}`}
              onClick={() => setEnvironment(value)}
            >
              {value}
            </button>
          ))}
        </div>
        <span className="spacer" />
        <button type="button" className="text-btn" onClick={() => setLogOpen(true)}>
          访问记录
        </button>
      </div>
      <div className="vault-note">
        <PrototypeIcon name="lock" />
        <span>原型仅保存密钥名称、版本和授权信息。请使用测试值，输入的密钥不会存储或发送。</span>
      </div>
      {visible.length === 0 ? (
        <ProtoEmpty
          icon="lock"
          title="这个环境还没有配置"
          description="环境之间不自动继承，避免测试与生产配置混用。"
          action={
            readOnly ? undefined : (
              <ProtoButton variant="primary" onClick={openCreate}>
                新增配置
              </ProtoButton>
            )
          }
        />
      ) : (
        <div className="table-wrap">
          <table className="table vault-table">
            <thead>
              <tr>
                <th>名称 / 类型</th>
                <th>值</th>
                <th>Bot 使用方式</th>
                <th>授权对象</th>
                <th>状态</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {visible.map((item) => (
                <tr key={item.id}>
                  <td>
                    <strong>{item.name}</strong>
                    <small>
                      {item.type} · v{item.version}
                    </small>
                  </td>
                  <td className="mono">{item.type === '密钥' ? '••••••••' : item.value}</td>
                  <td>
                    {item.auth}
                    <small>{item.environment}环境</small>
                  </td>
                  <td>{item.bots.join('、') || '未授权'}</td>
                  <td>
                    <ProtoChip tone="success">已配置</ProtoChip>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="text-btn"
                      disabled={readOnly}
                      onClick={() => {
                        setEditing(item)
                        setForm({ name: item.name, type: item.type, value: '', auth: item.auth })
                        setFormOpen(true)
                      }}
                    >
                      管理
                    </button>
                    <button
                      type="button"
                      className="text-btn"
                      disabled={readOnly}
                      onClick={() => {
                        setVariables((current) => current.filter((entry) => entry.id !== item.id))
                        showToast('已撤销配置引用（本地演示）')
                      }}
                    >
                      撤销
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="small quiet">
        运行时注入：执行工具使用密钥，聊天和模型不显示值。明文读取需单独授权，本原型也不回显输入值。
      </p>

      <PrototypeDialog
        open={formOpen}
        title={editing ? '管理配置' : '配置环境变量或密钥'}
        onClose={() => setFormOpen(false)}
      >
        <div className="info-box">请使用测试值。密钥值只在本次表单输入中存在，保存后立即丢弃；真实保险库尚未接入。</div>
        <div className="form-grid">
          <ProtoField label="名称">
            <input
              name="name"
              value={form.name}
              maxLength={80}
              placeholder="API_TOKEN"
              onChange={(event) => setForm({ ...form, name: event.target.value })}
            />
          </ProtoField>
          <ProtoField label="类型">
            <select
              value={form.type}
              disabled={Boolean(editing)}
              onChange={(event) => setForm({ ...form, type: event.target.value as DemoEnvironmentVariable['type'] })}
            >
              <option value="普通变量">变量</option>
              <option value="密钥">密钥</option>
            </select>
          </ProtoField>
          <ProtoField label={form.type === '密钥' ? '新密钥值（留空保留当前版本）' : '值'} full>
            <input
              type={form.type === '密钥' ? 'password' : 'text'}
              value={form.type === '密钥' ? '' : form.value}
              disabled={form.type === '密钥'}
              autoComplete="new-password"
              placeholder={form.type === '密钥' ? '仅输入测试值' : '配置值'}
              onChange={(event) => setForm({ ...form, value: event.target.value })}
            />
          </ProtoField>
          <ProtoField label="使用方式">
            <select
              value={form.auth}
              onChange={(event) => setForm({ ...form, auth: event.target.value as DemoEnvironmentVariable['auth'] })}
            >
              <option value="运行时注入">运行时注入</option>
              <option value="允许 Bot 读取">允许 Bot 读取明文</option>
            </select>
          </ProtoField>
          <ProtoField label="授权期限">
            <select defaultValue="24 小时">
              <option>仅当前任务</option>
              <option>24 小时</option>
              <option>长期有效</option>
            </select>
          </ProtoField>
        </div>
        <p className="small muted">
          运行时注入：执行工具使用密钥，聊天和模型不显示值。明文读取需单独授权，本原型也不回显输入值。
        </p>
        <div className="form-actions">
          <ProtoButton onClick={() => setFormOpen(false)}>取消</ProtoButton>
          <ProtoButton variant="primary" onClick={save}>
            {editing ? '保存配置' : '保存并授权'}
          </ProtoButton>
        </div>
      </PrototypeDialog>

      <PrototypeDialog open={logOpen} title="访问记录" onClose={() => setLogOpen(false)}>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>动作</th>
                <th>详情</th>
                <th>时间</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>配置请求</td>
                <td>研发助手请求测试环境 GIT_READ_TOKEN</td>
                <td>今天 10:02</td>
              </tr>
              <tr>
                <td>轮换</td>
                <td>林然轮换 GIT_READ_TOKEN v2</td>
                <td>今天 10:02</td>
              </tr>
              <tr>
                <td>读取</td>
                <td>项目助手读取 FEATURE_FLAGS</td>
                <td>昨天 17:22</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="form-actions">
          <ProtoButton variant="primary" onClick={() => setLogOpen(false)}>
            关闭
          </ProtoButton>
        </div>
      </PrototypeDialog>
    </>
  )
}
