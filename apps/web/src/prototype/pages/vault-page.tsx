import { useState } from 'react'
import type { FormEvent } from 'react'
import {
  ProtoButton,
  ProtoEmpty,
  ProtoField,
  ProtoIconButton,
  ProtoSearch,
} from '@/prototype/components/proto-controls'
import { PrototypeDialog } from '@/prototype/components/prototype-dialog'
import { PrototypeIcon } from '@/prototype/icons/icon'
import { usePrototypeMenu } from '@/prototype/layout/prototype-shell'
import { usePrototype } from '@/prototype/data/store'
import type { DemoProject } from '@/prototype/data/types'
import {
  addCredential,
  createVaultWorkspace,
  markRequestConfigured,
  revokeCredential,
  rotateCredential,
  submitVaultRequest,
  vaultBotOptions,
  vaultCategories,
} from '@/prototype/data/vault'
import type {
  NewCredentialInput,
  NewVaultRequestInput,
  VaultAuditEntry,
  VaultCategory,
  VaultCredential,
  VaultCredentialKind,
  VaultRequest,
  VaultValidity,
  VaultWorkspace,
} from '@/prototype/data/vault'

/** 原型固定以演示账号「林然」操作，与顶栏身份保持一致。 */
const demoActor = '林然'

/** 日志弹窗的筛选类型，与原型「全部 / 配置请求 / 管理记录」一致。 */
type LogFilter = '全部' | '配置请求' | '管理记录'

/** 日志弹窗筛选按钮顺序，与原型保持一致。 */
const logFilters: readonly LogFilter[] = ['全部', '配置请求', '管理记录']

/** 凭据分类下拉选项；分类筛选直接复用数据层定义。 */
const credentialKinds: readonly VaultCredentialKind[] = ['API 密钥', '账号密码', 'SSH 密钥']

/** 授权期限下拉选项，与原型表单顺序一致。 */
const validityOptions: readonly VaultValidity[] = ['长期有效', '24 小时']

/**
 * 把项目标识转换为当前团队的展示名称，未匹配时回退为标识本身。
 * @param projectIds 凭据授权的项目标识。
 * @param projects 当前团队项目列表。
 * @returns 顿号分隔的项目名称；无授权时返回空字符串。
 */
function projectNamesFor(projectIds: readonly string[], projects: readonly DemoProject[]): string {
  return projectIds.map((id) => projects.find((project) => project.id === id)?.name ?? id).join('、')
}

/**
 * 切换字符串数组中的单个选中值。
 * @param values 当前选中值。
 * @param value 需要加入或移除的值。
 * @returns 新的选中值数组，不修改原数组。
 */
function toggleSelection(values: string[], value: string): string[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value]
}

/**
 * 渲染团队凭据库：分类目录、条目列表、授权详情与右下角日志箱。
 * @returns 与原型 keychain-layout 结构一致的凭据库页面；密钥只以掩码展示，测试输入在提交或关闭后立即丢弃。
 */
export function VaultPage() {
  const { currentTeam, currentRole, teamProjects, showToast } = usePrototype()
  const { openMenu } = usePrototypeMenu()
  const [workspaces, setWorkspaces] = useState<Record<string, VaultWorkspace>>({})
  const [category, setCategory] = useState<VaultCategory>('全部')
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [newCredentialOpen, setNewCredentialOpen] = useState(false)
  const [sourceRequestId, setSourceRequestId] = useState('')
  const [rotateTarget, setRotateTarget] = useState<VaultCredential | null>(null)
  const [revokeTarget, setRevokeTarget] = useState<VaultCredential | null>(null)
  const [requestOpen, setRequestOpen] = useState(false)
  const [logsOpen, setLogsOpen] = useState(false)

  const workspace = workspaces[currentTeam.id] ?? createVaultWorkspace(currentTeam.id)
  const isAdmin = currentRole === '管理员'
  const isViewer = currentRole === '浏览者'
  const keyword = search.trim().toLowerCase()
  const visibleCredentials = workspace.credentials.filter((item) => {
    const matchesCategory = category === '全部' || (category === '已撤销' ? item.revoked : item.kind === category)
    const matchesSearch = !keyword || `${item.name} ${item.kind} ${item.description}`.toLowerCase().includes(keyword)
    return matchesCategory && matchesSearch
  })
  const selectedCredential = visibleCredentials.find((item) => item.id === selectedId) ?? visibleCredentials[0] ?? null
  const pendingRequestCount = workspace.requests.filter((request) => request.status === '待配置').length
  const sourceRequest = workspace.requests.find((request) => request.id === sourceRequestId) ?? null
  const hasFilters = category !== '全部' || search.trim().length > 0
  const canCreate = isAdmin
  const addActionLabel = isAdmin ? '添加凭据' : '请求配置'

  const saveWorkspace = (next: VaultWorkspace) => {
    setWorkspaces((current) => ({ ...current, [currentTeam.id]: next }))
  }

  const openNewCredential = () => {
    setSourceRequestId('')
    setNewCredentialOpen(true)
  }

  const openRequestForm = () => {
    setRequestOpen(true)
  }

  const handleAddAction = () => {
    if (isAdmin) {
      openNewCredential()
      return
    }
    openRequestForm()
  }

  const handleCreateCredential = (input: NewCredentialInput, requestId: string) => {
    const result = addCredential(workspace, input, demoActor)
    saveWorkspace(requestId ? markRequestConfigured(result.workspace, requestId, demoActor) : result.workspace)
    setSelectedId(result.credential.id)
    setCategory('全部')
    setSearch('')
    setNewCredentialOpen(false)
    setSourceRequestId('')
    showToast(
      requestId
        ? `已通过请求创建「${result.credential.name}」，测试密钥输入已丢弃（本地演示）`
        : `已创建凭据「${result.credential.name}」，测试密钥输入已丢弃（本地演示）`,
    )
  }

  const handleRotate = (credentialId: string) => {
    const target = workspace.credentials.find((item) => item.id === credentialId)
    saveWorkspace(rotateCredential(workspace, credentialId, demoActor))
    setRotateTarget(null)
    showToast(target ? `「${target.name}」已轮换到 v${target.version + 1}（本地演示）` : '凭据已轮换（本地演示）')
  }

  const handleRevoke = (credentialId: string) => {
    const target = workspace.credentials.find((item) => item.id === credentialId)
    saveWorkspace(revokeCredential(workspace, credentialId, demoActor))
    setRevokeTarget(null)
    showToast(target ? `已撤销「${target.name}」，原型不会调度真实任务（本地演示）` : '凭据已撤销（本地演示）')
  }

  const handleRequestSubmit = (input: NewVaultRequestInput) => {
    saveWorkspace(submitVaultRequest(workspace, input, demoActor))
    setRequestOpen(false)
    showToast('配置请求已记录（本地演示，不会通知管理员或发送邮件）')
  }

  const handleCopyReference = (credential: VaultCredential) => {
    const reference = `keychain://${currentTeam.id}/${credential.id}`
    if (!navigator.clipboard) {
      showToast(`当前环境不支持剪贴板，凭据引用：${reference}`)
      return
    }
    navigator.clipboard
      .writeText(reference)
      .then(() => showToast('已复制凭据引用，不包含密钥值。'))
      .catch(() => showToast(`复制失败，可手动记录：${reference}`))
  }

  const clearFilters = () => {
    setCategory('全部')
    setSearch('')
    setSelectedId('')
  }

  return (
    <>
      <h1 className="sr-only">凭据库</h1>
      <div className="keychain-layout">
        <aside className="keychain-list" aria-label="凭据目录">
          <div className="vault-toolbar">
            <ProtoIconButton label="展开导航" icon="menu" className="mobile-menu" onClick={openMenu} />
            <ProtoSearch label="搜索凭据" placeholder="搜索凭据" value={search} onChange={setSearch} />
            <ProtoIconButton
              label={addActionLabel}
              title={addActionLabel}
              icon="plus"
              className="vault-add"
              disabled={isViewer}
              onClick={handleAddAction}
            />
          </div>

          <div className="keychain-categories" role="group" aria-label="按分类筛选凭据">
            {vaultCategories.map((value) => (
              <button
                key={value}
                type="button"
                className={`btn${category === value ? ' blue' : ''}`}
                aria-pressed={category === value}
                onClick={() => {
                  setCategory(value)
                  setSelectedId('')
                }}
              >
                {value}
              </button>
            ))}
          </div>

          {visibleCredentials.map((item) => {
            const active = selectedCredential?.id === item.id
            return (
              <button
                key={item.id}
                type="button"
                className={`keychain-item${active ? ' selected' : ''}`}
                aria-current={active ? 'true' : undefined}
                onClick={() => setSelectedId(item.id)}
              >
                <span className="key-symbol">
                  <PrototypeIcon name="lock" />
                </span>
                <span>
                  <strong>{item.name}</strong>
                  <small>
                    {item.kind} · v{item.version}
                  </small>
                </span>
                {item.revoked && <small>不可用</small>}
              </button>
            )
          })}

          {visibleCredentials.length === 0 && (
            <div className="empty">
              <p>{workspace.credentials.length === 0 ? '暂无凭据' : '没有匹配的凭据'}</p>
              <small>
                {workspace.credentials.length === 0 ? '可添加 API、账号或 SSH 凭据。' : '调整分类或搜索关键词后重试。'}
              </small>
              {hasFilters && workspace.credentials.length > 0 && (
                <p>
                  <ProtoButton onClick={clearFilters}>清除筛选</ProtoButton>
                </p>
              )}
            </div>
          )}
        </aside>

        <section className="keychain-detail" aria-label="凭据详情">
          {selectedCredential ? (
            <CredentialDetail
              credential={selectedCredential}
              projects={teamProjects}
              isAdmin={isAdmin}
              isViewer={isViewer}
              onCopyReference={handleCopyReference}
              onRotate={setRotateTarget}
              onRevoke={setRevokeTarget}
            />
          ) : (
            <ProtoEmpty
              icon={workspace.credentials.length === 0 ? 'lock' : 'search'}
              title={workspace.credentials.length === 0 ? '团队的凭据保险箱' : '没有符合条件的凭据'}
              description={
                workspace.credentials.length === 0
                  ? '由管理员配置；Bot 和项目按范围使用。'
                  : '调整分类或搜索关键词后查看其他凭据。'
              }
              action={
                workspace.credentials.length === 0 ? (
                  canCreate ? (
                    <ProtoButton variant="primary" onClick={openNewCredential}>
                      <PrototypeIcon name="plus" />
                      添加第一条凭据
                    </ProtoButton>
                  ) : undefined
                ) : hasFilters ? (
                  <ProtoButton onClick={clearFilters}>清除筛选</ProtoButton>
                ) : undefined
              }
            />
          )}
        </section>
      </div>

      <button
        type="button"
        className="vault-log-trigger"
        aria-label={`打开日志箱${pendingRequestCount > 0 ? `，${pendingRequestCount} 项待配置` : ''}`}
        title="日志箱"
        onClick={() => setLogsOpen(true)}
      >
        <PrototypeIcon name="inbox" />
        {pendingRequestCount > 0 && <span className="vault-log-count">{pendingRequestCount}</span>}
      </button>

      {newCredentialOpen && (
        <NewCredentialDialog
          projects={teamProjects}
          existingNames={workspace.credentials.map((item) => item.name)}
          request={sourceRequest}
          onClose={() => {
            setNewCredentialOpen(false)
            setSourceRequestId('')
          }}
          onSubmit={handleCreateCredential}
        />
      )}

      {rotateTarget && (
        <RotateCredentialDialog
          credential={rotateTarget}
          onClose={() => setRotateTarget(null)}
          onConfirm={handleRotate}
        />
      )}

      {revokeTarget && (
        <RevokeCredentialDialog
          credential={revokeTarget}
          onClose={() => setRevokeTarget(null)}
          onConfirm={handleRevoke}
        />
      )}

      {requestOpen && <RequestCredentialDialog onClose={() => setRequestOpen(false)} onSubmit={handleRequestSubmit} />}

      {logsOpen && (
        <VaultLogDialog
          requests={workspace.requests}
          audit={workspace.audit}
          isAdmin={isAdmin}
          onConfigureRequest={(requestId) => {
            setSourceRequestId(requestId)
            setLogsOpen(false)
            setNewCredentialOpen(true)
          }}
          onClose={() => setLogsOpen(false)}
        />
      )}
    </>
  )
}

/**
 * 渲染单条凭据的授权详情与操作区。
 * @param props.credential 选中凭据；props.projects 当前团队项目；props.isAdmin 是否管理员；
 * props.isViewer 是否浏览者；props.onCopyReference 复制引用；props.onRotate/onRevoke 打开轮换或撤销确认。
 * @returns 与原型 key-properties 结构一致的凭据详情；非管理员看不到轮换与撤销入口。
 */
function CredentialDetail({
  credential,
  projects,
  isAdmin,
  isViewer,
  onCopyReference,
  onRotate,
  onRevoke,
}: {
  credential: VaultCredential
  projects: readonly DemoProject[]
  isAdmin: boolean
  isViewer: boolean
  onCopyReference: (credential: VaultCredential) => void
  onRotate: (credential: VaultCredential) => void
  onRevoke: (credential: VaultCredential) => void
}) {
  const projectNames = projectNamesFor(credential.allowedProjectIds, projects)
  return (
    <>
      <div className="row">
        <span className="key-symbol large">
          <PrototypeIcon name="lock" />
        </span>
        <div>
          <h2>{credential.name}</h2>
          <p>
            {credential.kind} · v{credential.version}
          </p>
        </div>
        <span className="spacer" />
        <span className="badge">{credential.revoked ? '已撤销 / 过期' : '可用'}</span>
      </div>

      <dl className="key-properties">
        <dt>说明</dt>
        <dd>{credential.description}</dd>
        <dt>密钥</dt>
        <dd>
          •••••••• <span className="small muted">原型不保存明文</span>
        </dd>
        <dt>使用方式</dt>
        <dd>运行时注入</dd>
        <dt>授权期限</dt>
        <dd>{credential.validity}</dd>
        <dt>项目</dt>
        <dd>{projectNames || '未授权'}</dd>
        <dt>Bots</dt>
        <dd>{credential.allowedBots.length > 0 ? credential.allowedBots.join('、') : '未授权'}</dd>
        <dt>版本</dt>
        <dd>v{credential.version}</dd>
        <dt>最近轮换</dt>
        <dd>{credential.rotatedAt}</dd>
      </dl>

      <div className="row key-actions">
        <ProtoButton onClick={() => onCopyReference(credential)}>复制引用</ProtoButton>
        {isAdmin && (
          <ProtoButton disabled={credential.revoked} onClick={() => onRotate(credential)}>
            轮换
          </ProtoButton>
        )}
        {isAdmin && (
          <ProtoButton disabled={credential.revoked} onClick={() => onRevoke(credential)}>
            撤销授权
          </ProtoButton>
        )}
      </div>

      {!isAdmin && (
        <p className="small muted">
          仅管理员可以轮换或撤销团队凭据；{isViewer ? '浏览者只能查看。' : '开发者可以提交配置请求，等待管理员配置。'}
        </p>
      )}

      <p className="small muted vault-prototype-note">
        复制操作只写入 keychain://团队/条目 引用标识，不包含密钥值；测试输入在提交或关闭表单后立即丢弃。
      </p>
    </>
  )
}

/**
 * 渲染新建凭据对话框。
 * @param props.projects 可授权的当前团队项目；props.existingNames 已有凭据名称；
 * props.request 可选来源配置请求；props.onClose 关闭对话框；props.onSubmit 提交元数据。
 * @returns 与原型添加凭据表单一致的原生对话框；测试密钥只做输入掩码，不写入提交数据。
 */
function NewCredentialDialog({
  projects,
  existingNames,
  request,
  onClose,
  onSubmit,
}: {
  projects: readonly DemoProject[]
  existingNames: readonly string[]
  request: VaultRequest | null
  onClose: () => void
  onSubmit: (input: NewCredentialInput, requestId: string) => void
}) {
  const [name, setName] = useState(request?.name ?? '')
  const [kind, setKind] = useState<VaultCredentialKind>('API 密钥')
  const [description, setDescription] = useState(request ? `配置请求用途：${request.purpose}` : '')
  const [validity, setValidity] = useState<VaultValidity>('长期有效')
  const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>([])
  const [selectedBots, setSelectedBots] = useState<string[]>([])
  const [secret, setSecret] = useState('')
  const [error, setError] = useState('')

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const trimmedName = name.trim()
    const trimmedDescription = description.trim()
    if (!trimmedName) {
      setError('请填写凭据名称。')
      return
    }
    if (existingNames.includes(trimmedName)) {
      setError('已有同名凭据，请换一个名称。')
      return
    }
    if (!trimmedDescription) {
      setError('请填写凭据说明与用途。')
      return
    }
    // 测试输入只用于验证掩码表现：提交前清空，且不进入提交数据。
    setSecret('')
    onSubmit(
      {
        name: trimmedName,
        kind,
        description: trimmedDescription,
        allowedProjectIds: selectedProjectIds,
        allowedBots: selectedBots,
        validity,
      },
      request?.id ?? '',
    )
  }

  return (
    <PrototypeDialog open title={request ? '配置请求凭据' : '添加团队凭据'} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="form-grid">
          <ProtoField label="名称">
            <input
              value={name}
              required
              maxLength={60}
              placeholder="例如：测试环境对象存储访问密钥"
              onChange={(event) => setName(event.target.value)}
            />
          </ProtoField>
          <ProtoField label="类型">
            <select value={kind} onChange={(event) => setKind(event.target.value as VaultCredentialKind)}>
              {credentialKinds.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </ProtoField>
          <ProtoField label="授权期限">
            <select value={validity} onChange={(event) => setValidity(event.target.value as VaultValidity)}>
              {validityOptions.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </ProtoField>
          <ProtoField label="测试密钥">
            <input
              type="password"
              autoComplete="new-password"
              value={secret}
              onChange={(event) => setSecret(event.target.value)}
              placeholder="仅演示输入掩码，提交后丢弃"
            />
          </ProtoField>
          <ProtoField label="说明与用途" full>
            <textarea
              value={description}
              required
              maxLength={1000}
              placeholder="说明使用场景、允许的环境与轮换要求"
              onChange={(event) => setDescription(event.target.value)}
            />
          </ProtoField>
          <div className="field full">
            <span>允许引用的项目</span>
            <div className="work-checks">
              {projects.map((project) => (
                <label key={project.id}>
                  <input
                    type="checkbox"
                    checked={selectedProjectIds.includes(project.id)}
                    onChange={() => setSelectedProjectIds((current) => toggleSelection(current, project.id))}
                  />
                  {project.name}
                </label>
              ))}
              {projects.length === 0 && <span className="small muted">当前团队还没有项目，可稍后补充授权。</span>}
            </div>
          </div>
          <div className="field full">
            <span>允许使用的 Bots</span>
            <div className="work-checks">
              {vaultBotOptions.map((bot) => (
                <label key={bot}>
                  <input
                    type="checkbox"
                    checked={selectedBots.includes(bot)}
                    onChange={() => setSelectedBots((current) => toggleSelection(current, bot))}
                  />
                  {bot}
                </label>
              ))}
            </div>
          </div>
        </div>
        <p className="small muted">项目引用不会扩大授权。真实值不存入浏览器、聊天、模板或公开链接。</p>
        <p className="field-error" role="alert">
          {error}
        </p>
        <div className="form-actions">
          <ProtoButton onClick={onClose}>取消</ProtoButton>
          <ProtoButton type="submit" variant="primary">
            保存凭据
          </ProtoButton>
        </div>
      </form>
    </PrototypeDialog>
  )
}

/**
 * 渲染轮换凭据确认对话框。
 * @param props.credential 目标凭据；props.onClose 关闭；props.onConfirm 确认轮换。
 * @returns 与原型表单类一致的原生对话框；新测试密钥输入不会保存。
 */
function RotateCredentialDialog({
  credential,
  onClose,
  onConfirm,
}: {
  credential: VaultCredential
  onClose: () => void
  onConfirm: (credentialId: string) => void
}) {
  const [secret, setSecret] = useState('')

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSecret('')
    onConfirm(credential.id)
  }

  return (
    <PrototypeDialog open title="轮换凭据" onClose={onClose}>
      <div className="info-box">
        轮换会更新版本号与最近轮换时间，项目引用按新版本生效；原型不调用真实密钥服务。 「{credential.name}」将从 v
        {credential.version} 更新为 v{credential.version + 1}。
      </div>
      <form onSubmit={submit}>
        <div className="form-grid">
          <ProtoField label="新测试密钥（可选）" full>
            <input
              type="password"
              autoComplete="new-password"
              value={secret}
              onChange={(event) => setSecret(event.target.value)}
              placeholder="仅演示输入掩码，不会保存"
            />
            <span className="small muted">输入值只用于演示掩码，确认后立即丢弃；原型没有真实密钥库。</span>
          </ProtoField>
        </div>
        <div className="form-actions">
          <ProtoButton onClick={onClose}>取消</ProtoButton>
          <ProtoButton type="submit" variant="primary">
            确认轮换
          </ProtoButton>
        </div>
      </form>
    </PrototypeDialog>
  )
}

/**
 * 渲染撤销凭据的确认对话框。
 * @param props.credential 目标凭据；props.onClose 关闭；props.onConfirm 确认撤销。
 * @returns 撤销影响说明与确认操作；不触发真实任务或环境变量调度。
 */
function RevokeCredentialDialog({
  credential,
  onClose,
  onConfirm,
}: {
  credential: VaultCredential
  onClose: () => void
  onConfirm: (credentialId: string) => void
}) {
  return (
    <PrototypeDialog open title="撤销凭据" onClose={onClose}>
      <div className="info-box">
        撤销后「{credential.name}」的项目引用立即失效，依赖它的任务在正式实现中会被阻塞。
        原型只更新本地元数据，不会调用密钥服务或调度真实任务；撤销后仍可在「已撤销」分类中核对记录。
      </div>
      <div className="form-actions">
        <ProtoButton onClick={onClose}>取消</ProtoButton>
        <ProtoButton variant="primary" onClick={() => onConfirm(credential.id)}>
          确认撤销
        </ProtoButton>
      </div>
    </PrototypeDialog>
  )
}

/**
 * 渲染配置请求表单对话框，供非管理员演示「请求管理员配置」流程。
 * @param props.onClose 关闭；props.onSubmit 提交请求名称与用途。
 * @returns 与原型请求表单一致的原生对话框；请求只写入本地数据，不发送通知。
 */
function RequestCredentialDialog({
  onClose,
  onSubmit,
}: {
  onClose: () => void
  onSubmit: (input: NewVaultRequestInput) => void
}) {
  const [name, setName] = useState('')
  const [purpose, setPurpose] = useState('')
  const [error, setError] = useState('')

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!name.trim() || !purpose.trim()) {
      setError('请填写凭据名称与用途。')
      return
    }
    onSubmit({ name: name.trim(), purpose: purpose.trim() })
  }

  return (
    <PrototypeDialog open title="请求团队配置" onClose={onClose}>
      <div className="info-box">请求只记录在当前浏览器的演示数据中，不会通知管理员、发送邮件或创建真实密钥。</div>
      <form onSubmit={submit}>
        <ProtoField label="凭据名称">
          <input
            value={name}
            required
            maxLength={60}
            placeholder="例如：测试环境对象存储访问密钥"
            onChange={(event) => setName(event.target.value)}
          />
        </ProtoField>
        <ProtoField label="用途与使用范围">
          <textarea
            value={purpose}
            required
            maxLength={1000}
            placeholder="说明需要授权的项目、Bot 与期限"
            onChange={(event) => setPurpose(event.target.value)}
          />
        </ProtoField>
        <p className="field-error" role="alert">
          {error}
        </p>
        <div className="form-actions">
          <ProtoButton onClick={onClose}>取消</ProtoButton>
          <ProtoButton type="submit" variant="primary">
            提交请求
          </ProtoButton>
        </div>
      </form>
    </PrototypeDialog>
  )
}

/**
 * 渲染日志弹窗，用原型筛选按钮在配置请求与管理记录之间切换。
 * @param props.requests 当前团队配置请求；props.audit 管理记录；props.isAdmin 是否管理员；
 * props.onConfigureRequest 从请求进入配置；props.onClose 关闭弹窗。
 * @returns 与原型 vault-log-* 结构一致的日志弹窗；长记录在弹窗内滚动。
 */
function VaultLogDialog({
  requests,
  audit,
  isAdmin,
  onConfigureRequest,
  onClose,
}: {
  requests: readonly VaultRequest[]
  audit: readonly VaultAuditEntry[]
  isAdmin: boolean
  onConfigureRequest: (requestId: string) => void
  onClose: () => void
}) {
  const [filter, setFilter] = useState<LogFilter>('全部')
  const showRequests = filter !== '管理记录'
  const showAudit = filter !== '配置请求'
  const visibleRequests = showRequests ? requests : []
  const visibleAudit = showAudit ? audit : []
  const isEmpty = visibleRequests.length === 0 && visibleAudit.length === 0

  return (
    <PrototypeDialog open title="活动记录" onClose={onClose}>
      <div className="vault-log-filters" role="group" aria-label="日志类型">
        {logFilters.map((name) => (
          <button
            key={name}
            type="button"
            className={`btn${filter === name ? ' blue' : ''}`}
            aria-pressed={filter === name}
            onClick={() => setFilter(name)}
          >
            {name}
          </button>
        ))}
      </div>
      <div className="vault-log-entries">
        {visibleRequests.length > 0 && (
          <section aria-label="配置请求">
            {visibleRequests.map((request) => (
              <article key={request.id} className="vault-log-request">
                <div className="row">
                  <strong>{request.name}</strong>
                  <span className="small quiet">
                    {request.requestedAt} · {request.requester}
                  </span>
                  <span className="spacer" />
                  <span className="badge">{request.status}</span>
                </div>
                <p>{request.purpose}</p>
                {isAdmin && request.status === '待配置' && (
                  <ProtoButton onClick={() => onConfigureRequest(request.id)}>配置</ProtoButton>
                )}
              </article>
            ))}
          </section>
        )}
        {visibleAudit.length > 0 && (
          <section aria-label="管理记录">
            {visibleAudit.map((entry) => (
              <p key={entry.id} className="vault-log-entry">
                {entry.time} · {entry.actor} · {entry.action}
              </p>
            ))}
          </section>
        )}
        {isEmpty && <div className="vault-log-empty">暂无记录</div>}
      </div>
    </PrototypeDialog>
  )
}
