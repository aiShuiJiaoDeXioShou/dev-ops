/** 原型凭据库支持的凭据分类，与旧 HTML 原型保持一致。 */
export type VaultCredentialKind = 'API 密钥' | '账号密码' | 'SSH 密钥'

/** 凭据授权期限的展示取值；原型不实现真实的到期调度。 */
export type VaultValidity = '长期有效' | '24 小时'

/** 凭据目录的分类筛选值，「已撤销」用于查看失效记录。 */
export const vaultCategories = ['全部', 'API 密钥', '账号密码', 'SSH 密钥', '已撤销'] as const

/** 凭据目录的分类筛选类型。 */
export type VaultCategory = (typeof vaultCategories)[number]

/** 原型可授权给团队凭据的演示 Bot 名称；正式实现应读取团队 Bot 列表。 */
export const vaultBotOptions = ['项目助手', '研发助手', '产品助手', '交付助手'] as const

/** 一条团队凭据的元数据；不包含密钥明文，页面只展示掩码。 */
export interface VaultCredential {
  id: string
  name: string
  kind: VaultCredentialKind
  description: string
  /** 允许引用的项目标识，对应 DemoProject.id。 */
  allowedProjectIds: string[]
  /** 允许使用的演示 Bot 名称。 */
  allowedBots: string[]
  validity: VaultValidity
  version: number
  /** 最近一次轮换的本地时间展示。 */
  rotatedAt: string
  revoked: boolean
}

/** 配置请求状态；原型中仅管理员可从待配置请求创建凭据。 */
export type VaultRequestStatus = '待配置' | '已配置'

/** 开发者提交的团队配置请求。 */
export interface VaultRequest {
  id: string
  requester: string
  name: string
  purpose: string
  requestedAt: string
  status: VaultRequestStatus
}

/** 凭据库管理记录，最新记录位于数组最前。 */
export interface VaultAuditEntry {
  id: string
  time: string
  actor: string
  action: string
}

/** 一个团队的凭据库演示工作区。 */
export interface VaultWorkspace {
  credentials: VaultCredential[]
  requests: VaultRequest[]
  audit: VaultAuditEntry[]
}

/** 新建凭据表单数据；刻意不包含密钥字段，避免真实值进入数据层。 */
export interface NewCredentialInput {
  name: string
  kind: VaultCredentialKind
  description: string
  allowedProjectIds: string[]
  allowedBots: string[]
  validity: VaultValidity
}

/** 配置请求表单数据。 */
export interface NewVaultRequestInput {
  name: string
  purpose: string
}

/** 新建凭据后的返回值，便于页面直接选中新记录。 */
export interface AddCredentialResult {
  workspace: VaultWorkspace
  credential: VaultCredential
}

/**
 * 生成原型中的本地时间展示文案。
 * @param time 需要展示的时间，默认当前时间。
 * @returns 形如 `2026-11-10 09:24` 的本地时间文本；不包含时区信息。
 */
export function formatVaultTime(time: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${time.getFullYear()}-${pad(time.getMonth() + 1)}-${pad(time.getDate())} ${pad(time.getHours())}:${pad(time.getMinutes())}`
}

/**
 * 创建指定团队的凭据库演示数据。
 * @param teamId 当前演示团队标识。
 * @returns 每个团队独立的工作区；未知团队返回空工作区，不跨团队共享数组。
 */
export function createVaultWorkspace(teamId: string): VaultWorkspace {
  if (teamId === 'rd') return createRdWorkspace()
  if (teamId === 'product') return createProductWorkspace()
  return { credentials: [], requests: [], audit: [] }
}

/**
 * 构造研发团队示例凭据，覆盖可用、短期与已撤销记录。
 * @returns 研发团队的独立演示工作区。
 */
function createRdWorkspace(): VaultWorkspace {
  return {
    credentials: [
      {
        id: 'credential-rd-github',
        name: 'GitHub 部署令牌',
        kind: 'API 密钥',
        description: '用于研发协作平台在构建完成后同步镜像标签，仅授予只读仓库元数据权限。',
        allowedProjectIds: ['dev-ops'],
        allowedBots: ['项目助手', '研发助手'],
        validity: '长期有效',
        version: 3,
        rotatedAt: '2026-11-08 10:20',
        revoked: false,
      },
      {
        id: 'credential-rd-data-account',
        name: '数据平台只读账号',
        kind: '账号密码',
        description: '数据平台报表账号，仅用于测试环境读取指标快照，禁止在生产环境引用。',
        allowedProjectIds: ['data-platform'],
        allowedBots: ['产品助手'],
        validity: '24 小时',
        version: 2,
        rotatedAt: '2026-11-09 16:45',
        revoked: false,
      },
      {
        id: 'credential-rd-build-ssh',
        name: '构建节点 SSH 密钥',
        kind: 'SSH 密钥',
        description: '流水线执行节点登录密钥，只允许构建机访问测试环境服务器。',
        allowedProjectIds: ['dev-ops', 'data-platform'],
        allowedBots: ['交付助手'],
        validity: '长期有效',
        version: 5,
        rotatedAt: '2026-10-28 09:05',
        revoked: false,
      },
      {
        id: 'credential-rd-old-registry',
        name: '旧版镜像仓库令牌',
        kind: 'API 密钥',
        description: '已停止使用的镜像仓库令牌，保留记录用于核对历史授权与撤销动作。',
        allowedProjectIds: [],
        allowedBots: [],
        validity: '长期有效',
        version: 1,
        rotatedAt: '2026-08-14 11:30',
        revoked: true,
      },
    ],
    requests: [
      {
        id: 'request-rd-oss',
        requester: '陈悦',
        name: '测试环境对象存储访问密钥',
        purpose: '用于验证测试环境附件上传与下载流程，只授权数据平台项目与研发助手。',
        requestedAt: '2026-11-09 15:20',
        status: '待配置',
      },
      {
        id: 'request-rd-push',
        requester: '周宁',
        name: '客户应用推送证书',
        purpose: '用于验证移动端推送配置，证书由管理员统一轮换。',
        requestedAt: '2026-11-04 09:10',
        status: '已配置',
      },
    ],
    audit: [
      { id: 'audit-rd-1', time: '2026-11-09 16:45', actor: '林然', action: '轮换凭据：数据平台只读账号（v1 → v2）' },
      { id: 'audit-rd-2', time: '2026-11-08 10:20', actor: '林然', action: '轮换凭据：GitHub 部署令牌（v2 → v3）' },
      { id: 'audit-rd-3', time: '2026-11-04 09:12', actor: '林然', action: '配置凭据：客户应用推送证书' },
      { id: 'audit-rd-4', time: '2026-08-20 14:02', actor: '林然', action: '撤销凭据：旧版镜像仓库令牌' },
    ],
  }
}

/**
 * 构造产品团队示例凭据，与研发团队数据完全隔离。
 * @returns 产品团队的独立演示工作区。
 */
function createProductWorkspace(): VaultWorkspace {
  return {
    credentials: [
      {
        id: 'credential-product-release',
        name: '客户应用发布令牌',
        kind: 'API 密钥',
        description: '用于客户应用发布流水线拉取制品清单，只在产品团队内有效。',
        allowedProjectIds: ['mobile-app'],
        allowedBots: ['产品助手', '交付助手'],
        validity: '长期有效',
        version: 2,
        rotatedAt: '2026-11-06 17:30',
        revoked: false,
      },
      {
        id: 'credential-product-admin',
        name: '运营后台管理员账号',
        kind: '账号密码',
        description: '运维控制台演示账号，仅在测试环境短期授权，到期后重新配置。',
        allowedProjectIds: ['ops-console'],
        allowedBots: [],
        validity: '24 小时',
        version: 1,
        rotatedAt: '2026-11-07 11:05',
        revoked: false,
      },
      {
        id: 'credential-product-bastion',
        name: '产品环境堡垒机密钥',
        kind: 'SSH 密钥',
        description: '用于产品团队两个项目的测试环境排查，禁止引用到生产环境。',
        allowedProjectIds: ['mobile-app', 'ops-console'],
        allowedBots: ['交付助手'],
        validity: '长期有效',
        version: 1,
        rotatedAt: '2026-10-30 08:40',
        revoked: false,
      },
    ],
    requests: [
      {
        id: 'request-product-sign',
        requester: '许嘉',
        name: '邀请链接签名密钥',
        purpose: '用于验证客户邀请链接的签名与过期逻辑，需要产品助手可用。',
        requestedAt: '2026-11-08 13:40',
        status: '待配置',
      },
    ],
    audit: [
      { id: 'audit-product-1', time: '2026-11-07 11:05', actor: '林然', action: '配置凭据：运营后台管理员账号' },
      {
        id: 'audit-product-2',
        time: '2026-11-06 17:30',
        actor: '林然',
        action: '轮换凭据：客户应用发布令牌（v1 → v2）',
      },
    ],
  }
}

/**
 * 追加一条管理记录，最新的记录排在最前。
 * @param workspace 当前团队凭据库工作区。
 * @param action 管理动作说明，页面直接展示。
 * @param actor 操作人名称。
 * @param time 记录时间，默认当前时间。
 * @returns 返回新的工作区，不修改传入对象。
 */
export function appendAudit(
  workspace: VaultWorkspace,
  action: string,
  actor: string,
  time = formatVaultTime(),
): VaultWorkspace {
  const entry: VaultAuditEntry = { id: `audit-${Date.now()}-${workspace.audit.length}`, time, actor, action }
  return { ...workspace, audit: [entry, ...workspace.audit] }
}

/**
 * 构造一条凭据元数据；版本从 1 开始，且不接收任何密钥值。
 * @param input 新建凭据表单数据。
 * @returns 未撤销的凭据记录，最近轮换时间为当前时间。
 */
function createCredential(input: NewCredentialInput): VaultCredential {
  return {
    id: `credential-${Date.now()}`,
    name: input.name,
    kind: input.kind,
    description: input.description,
    allowedProjectIds: [...input.allowedProjectIds],
    allowedBots: [...input.allowedBots],
    validity: input.validity,
    version: 1,
    rotatedAt: formatVaultTime(),
    revoked: false,
  }
}

/**
 * 新建一条凭据并把操作写入管理记录。
 * @param workspace 当前团队凭据库工作区。
 * @param input 新建凭据表单数据，不含密钥值。
 * @param actor 操作人名称。
 * @returns 新工作区与新建的凭据记录；新凭据位于列表最前，页面可直接选中。
 */
export function addCredential(
  workspace: VaultWorkspace,
  input: NewCredentialInput,
  actor: string,
): AddCredentialResult {
  const credential = createCredential(input)
  const workspaceWithCredential: VaultWorkspace = { ...workspace, credentials: [credential, ...workspace.credentials] }
  return {
    workspace: appendAudit(workspaceWithCredential, `创建凭据：${credential.name}`, actor),
    credential,
  }
}

/**
 * 轮换凭据版本并刷新最近轮换时间。
 * @param workspace 当前团队凭据库工作区。
 * @param credentialId 目标凭据标识。
 * @param actor 操作人名称。
 * @returns 新的工作区；凭据不存在或已撤销时原样返回，不产生记录。
 */
export function rotateCredential(workspace: VaultWorkspace, credentialId: string, actor: string): VaultWorkspace {
  const credential = workspace.credentials.find((item) => item.id === credentialId)
  if (!credential || credential.revoked) return workspace
  const nextVersion = credential.version + 1
  const next: VaultWorkspace = {
    ...workspace,
    credentials: workspace.credentials.map((item) =>
      item.id === credentialId ? { ...item, version: nextVersion, rotatedAt: formatVaultTime() } : item,
    ),
  }
  return appendAudit(next, `轮换凭据：${credential.name}（v${credential.version} → v${nextVersion}）`, actor)
}

/**
 * 撤销凭据授权；已撤销的凭据保留在目录中供核对。
 * @param workspace 当前团队凭据库工作区。
 * @param credentialId 目标凭据标识。
 * @param actor 操作人名称。
 * @returns 新的工作区；凭据不存在或已撤销时原样返回，不产生记录。
 */
export function revokeCredential(workspace: VaultWorkspace, credentialId: string, actor: string): VaultWorkspace {
  const credential = workspace.credentials.find((item) => item.id === credentialId)
  if (!credential || credential.revoked) return workspace
  const next: VaultWorkspace = {
    ...workspace,
    credentials: workspace.credentials.map((item) => (item.id === credentialId ? { ...item, revoked: true } : item)),
  }
  return appendAudit(next, `撤销凭据：${credential.name}`, actor)
}

/**
 * 提交一条团队配置请求。
 * @param workspace 当前团队凭据库工作区。
 * @param input 请求名称与用途。
 * @param requester 请求人名称。
 * @returns 新的工作区；请求状态为待配置，并追加一条管理记录。
 */
export function submitVaultRequest(
  workspace: VaultWorkspace,
  input: NewVaultRequestInput,
  requester: string,
): VaultWorkspace {
  const request: VaultRequest = {
    id: `request-${Date.now()}`,
    requester,
    name: input.name,
    purpose: input.purpose,
    requestedAt: formatVaultTime(),
    status: '待配置',
  }
  const next: VaultWorkspace = { ...workspace, requests: [request, ...workspace.requests] }
  return appendAudit(next, `提交配置请求：${request.name}`, requester)
}

/**
 * 把待配置请求标记为已配置。
 * @param workspace 当前团队凭据库工作区。
 * @param requestId 目标请求标识。
 * @param actor 操作人名称。
 * @returns 新的工作区；请求不存在或已配置时原样返回，不产生记录。
 */
export function markRequestConfigured(workspace: VaultWorkspace, requestId: string, actor: string): VaultWorkspace {
  const request = workspace.requests.find((item) => item.id === requestId)
  if (!request || request.status === '已配置') return workspace
  const next: VaultWorkspace = {
    ...workspace,
    requests: workspace.requests.map((item) => (item.id === requestId ? { ...item, status: '已配置' } : item)),
  }
  return appendAudit(next, `配置凭据：${request.name}`, actor)
}
