import { useCallback, useEffect, useState } from 'react'

/** 智能体运行环境，对应能力页中的执行节点类型。 */
export const botRuntimes = ['团队执行器', '本地节点'] as const
export type BotRuntime = (typeof botRuntimes)[number]

/** 原型中可选的模型候选项，只记录选择结果，不调用真实模型。 */
export const botModels = ['默认模型', 'DeepSeek'] as const

/** Skill 分类，与旧 HTML 原型能力页的分类 pills 保持一致。 */
export const skillCategories = ['产品', '研发', '交付'] as const
export type SkillCategory = (typeof skillCategories)[number]

/** 独立智能体的演示定义；项目能力授权记录在 projectIds 中。 */
export interface DemoBot {
  id: string
  teamId: string
  name: string
  role: string
  owner: string
  runtime: BotRuntime
  model: string
  instructions: string
  skills: string[]
  projectIds: string[]
  enabled: boolean
  online: boolean
  lastActive: string
}

/** 智能体运行记录的结果状态，环境离线单独表达而不是记录为失败。 */
export type BotRunResult = '已完成' | '受阻' | '运行环境离线'

/** 智能体最近一次运行记录，仅用于详情页展示。 */
export interface DemoBotRun {
  id: string
  botId: string
  projectId: string
  title: string
  time: string
  result: BotRunResult
}

/** 团队 Skill 的演示定义；指令内容对应 SKILL.md。 */
export interface DemoSkill {
  id: string
  teamId: string
  name: string
  category: SkillCategory
  description: string
  instructions: string
  version: string
  source: string
  enabled: boolean
}

/** AGENTS.md 模板的演示定义；正文保存 Markdown 全文。 */
export interface DemoAgentTemplate {
  id: string
  teamId: string
  name: string
  tag: string
  description: string
  content: string
  version: string
}

/** 项目记忆，botId 为空字符串表示团队共识而非单个智能体的记忆。 */
export interface DemoMemory {
  id: string
  teamId: string
  projectId: string
  botId: string
  text: string
  source: string
  confirmed: boolean
  updated: string
}

/** 外部连接状态；已配置只代表本地保存了配置，不代表连接成功。 */
export const connectionStatuses = ['已配置 · 未连接', '待配置'] as const
export type ConnectionStatus = (typeof connectionStatuses)[number]

/** 外部连接配置，只保存地址与凭据引用名称。 */
export interface DemoConnection {
  id: string
  teamId: string
  name: string
  kind: string
  endpoint: string
  secretRef: string
  status: ConnectionStatus
}

/** 能力中心五个页面共享的演示数据，独立持久化以免修改现有 store 结构。 */
export interface CapabilityData {
  version: 1
  bots: DemoBot[]
  runs: DemoBotRun[]
  skills: DemoSkill[]
  templates: DemoAgentTemplate[]
  memories: DemoMemory[]
  connections: DemoConnection[]
  /** 项目 ID 到当前选用的 AGENTS.md 模板 ID。 */
  projectTemplates: Record<string, string>
}

/** 能力演示数据在浏览器中的存储键，与项目/事项数据分开维护。 */
const CAPABILITY_STORAGE_KEY = 'dev-ops-prototype:capabilities:v1'

/** 构造智能体目录的初始演示数据。 */
function seedBots(): DemoBot[] {
  return [
    {
      id: 'product',
      teamId: 'rd',
      name: '小李',
      role: '产品助手',
      owner: '林然',
      runtime: '团队执行器',
      model: 'DeepSeek',
      instructions: '梳理需求、验收标准与待确认问题，帮助团队明确工作范围。',
      skills: ['requirements', 'bug-triage'],
      projectIds: ['dev-ops', 'data-platform'],
      enabled: true,
      online: true,
      lastActive: '刚刚',
    },
    {
      id: 'engineer',
      teamId: 'rd',
      name: '小林',
      role: '研发助手',
      owner: '林然',
      runtime: '团队执行器',
      model: '默认模型',
      instructions: '结合代码和 PR 整理评审重点，检查接口约定与验证边界。',
      skills: ['pr-review', 'api-contract', 'bug-triage'],
      projectIds: ['dev-ops', 'data-platform'],
      enabled: true,
      online: true,
      lastActive: '12 分钟前',
    },
    {
      id: 'delivery',
      teamId: 'rd',
      name: '小渡',
      role: '交付助手',
      owner: '陈悦',
      runtime: '本地节点',
      model: '默认模型',
      instructions: '核对构建产物与环境版本，整理测试交接，不执行部署和发布。',
      skills: ['release-summary', 'release-check'],
      projectIds: ['dev-ops'],
      enabled: true,
      online: false,
      lastActive: '2 小时前',
    },
    {
      id: 'mobile',
      teamId: 'product',
      name: '星野',
      role: '移动端助手',
      owner: '周宁',
      runtime: '团队执行器',
      model: '默认模型',
      instructions: '整理移动端需求、问题复现步骤与测试范围，保留客户反馈原文。',
      skills: ['requirements', 'mobile-acceptance'],
      projectIds: ['mobile-app'],
      enabled: true,
      online: true,
      lastActive: '昨天',
    },
    {
      id: 'assistant',
      teamId: 'product',
      name: '阿策',
      role: '产品运营助手',
      owner: '许嘉',
      runtime: '本地节点',
      model: '默认模型',
      instructions: '归纳客户反馈、影响范围与待确认问题，整理给产品团队跟进。',
      skills: ['feedback-review', 'requirements'],
      projectIds: ['mobile-app', 'ops-console'],
      enabled: true,
      online: false,
      lastActive: '昨天',
    },
  ]
}

/** 构造智能体最近运行记录的初始演示数据。 */
function seedRuns(): DemoBotRun[] {
  return [
    {
      id: 'run-product-1',
      botId: 'product',
      projectId: 'dev-ops',
      title: '整理本轮需求与待确认事项',
      time: '今天 09:42',
      result: '已完成',
    },
    {
      id: 'run-engineer-1',
      botId: 'engineer',
      projectId: 'dev-ops',
      title: '核对 PR #42 的兼容性说明',
      time: '今天 09:30',
      result: '已完成',
    },
    {
      id: 'run-delivery-1',
      botId: 'delivery',
      projectId: 'dev-ops',
      title: '汇总测试环境运行版本',
      time: '昨天 18:10',
      result: '运行环境离线',
    },
    {
      id: 'run-mobile-1',
      botId: 'mobile',
      projectId: 'mobile-app',
      title: '整理移动端登录体验验收要点',
      time: '昨天 16:05',
      result: '已完成',
    },
    {
      id: 'run-assistant-1',
      botId: 'assistant',
      projectId: 'ops-console',
      title: '汇总客户反馈与影响范围',
      time: '11月08日 10:20',
      result: '受阻',
    },
  ]
}

/** 构造两个演示团队的 Skill 库初始数据。 */
function seedSkills(): DemoSkill[] {
  const rows: Array<[string, string, string, SkillCategory, string, string, string, boolean]> = [
    [
      'requirements',
      'rd',
      '需求梳理',
      '产品',
      '将需求整理成目标、验收标准与待确认事项。',
      '梳理背景与目标；列出验收标准；标注尚未确认的问题。',
      '1.2.0',
      true,
    ],
    [
      'pr-review',
      'rd',
      'PR 审阅',
      '研发',
      '结合变更文件，整理评审重点与验证建议。',
      '读取指定 PR 的变更；归纳影响范围；提出需要验证的边界条件。',
      '1.1.0',
      true,
    ],
    [
      'release-summary',
      'rd',
      '交付摘要',
      '交付',
      '核对构建产物与环境版本，准备测试交接。',
      '区分构建产物与运行版本；整理差异；输出测试交接要点。',
      '1.0.2',
      true,
    ],
    [
      'bug-triage',
      'rd',
      'Bug 分析',
      '研发',
      '整理复现步骤、影响范围与关联事项。',
      '读取指定 Bug；归纳复现条件；标注缺失信息；建议验证步骤。',
      '1.0.0',
      true,
    ],
    [
      'api-contract',
      'rd',
      '接口核对',
      '研发',
      '检查接口约定、错误码与兼容性说明。',
      '核对请求和响应契约；识别不兼容变化；输出需补充的说明。',
      '1.0.0',
      true,
    ],
    [
      'release-check',
      'rd',
      '发布核对',
      '交付',
      '核对版本与人工放行信息。',
      '核对产物版本、目标环境和人工放行信息；不执行部署或发布。',
      '0.9.0',
      false,
    ],
    [
      'requirements',
      'product',
      '需求梳理',
      '产品',
      '把客户反馈整理成目标、验收标准与待确认事项。',
      '归纳反馈原文；列出验收标准；标注尚未确认的问题。',
      '1.0.0',
      true,
    ],
    [
      'feedback-review',
      'product',
      '反馈归类',
      '产品',
      '将客户反馈按主题与影响范围归类。',
      '读取反馈原文；归纳主题；标注受影响版本与客户。',
      '1.0.0',
      true,
    ],
    [
      'mobile-acceptance',
      'product',
      '移动端验收',
      '交付',
      '按 iOS 与 Android 场景整理验收清单。',
      '列出首启、登录与返回前台场景；标注验收结论与待确认项。',
      '0.9.0',
      true,
    ],
    [
      'release-check',
      'product',
      '发布核对',
      '交付',
      '核对版本与人工放行信息。',
      '核对产物版本、目标环境和人工放行信息；不执行部署或发布。',
      '0.9.0',
      false,
    ],
  ]
  return rows.map(([id, teamId, name, category, description, instructions, version, enabled]) => ({
    id,
    teamId,
    name,
    category,
    description,
    instructions,
    version,
    source: '团队维护',
    enabled,
  }))
}

/** 构造两个演示团队的 AGENTS.md 模板初始数据。 */
function seedTemplates(): DemoAgentTemplate[] {
  return [
    {
      id: 'team-default',
      teamId: 'rd',
      name: '团队通用',
      tag: '通用',
      description: '适合日常项目协作，统一沟通、权限与交付边界。',
      version: '1',
      content:
        '# AGENTS.md\n\n## 协作约定\n- 使用中文沟通，明确事实与待确认事项。\n- 通过 @ 引用仓库、文件与 PR，避免猜测上下文。\n- 优先调用团队已启用的 Skills。\n\n## 工作边界\n- 保留他人尚未完成的修改。\n- 提测状态不触发流水线。\n- 发布前遵循团队人工放行流程。',
    },
    {
      id: 'web-team',
      teamId: 'rd',
      name: 'Web 研发',
      tag: 'React / TypeScript',
      description: '前端项目的类型约束、组件职责与验证要求。',
      version: '2',
      content:
        '# AGENTS.md\n\n## Web 研发约定\n- 使用 TypeScript，保持类型准确。\n- 组件聚焦展示与交互，避免重复状态。\n- 遵循项目已有样式和可访问性规范。\n- 修改后运行项目约定的检查和构建。\n\n## 协作\n- 通过 @ 引用文件、需求与 PR。\n- 仅调用团队已启用的 Skills。',
    },
    {
      id: 'service-team',
      teamId: 'rd',
      name: '服务端研发',
      tag: 'API / 数据库',
      description: '接口契约、权限校验、数据一致性与迁移约定。',
      version: '1',
      content:
        '# AGENTS.md\n\n## 服务端研发约定\n- 在服务端校验身份、资源归属和权限。\n- 外部输入必须校验，外部调用必须设置超时。\n- 数据库变更使用版本化迁移。\n- 不向客户端暴露凭据、SQL 或内部堆栈。\n\n## 验证\n- 覆盖权限、失败路径和并发边界。\n- 使用团队 Skills 辅助核对接口契约。',
    },
    {
      id: 'team-default',
      teamId: 'product',
      name: '团队通用',
      tag: '通用',
      description: '适合日常项目协作，统一沟通、权限与交付边界。',
      version: '1',
      content:
        '# AGENTS.md\n\n## 协作约定\n- 使用中文沟通，明确事实与待确认事项。\n- 通过 @ 引用项目资源，避免猜测上下文。\n- 优先调用团队已启用的 Skills。\n\n## 工作边界\n- 客户可见文案需经产品确认。\n- 提测状态不触发流水线。\n- 发布前遵循团队人工放行流程。',
    },
    {
      id: 'mobile-team',
      teamId: 'product',
      name: '移动端研发',
      tag: 'Flutter / iOS',
      description: '移动端项目的兼容性、验收与发布约定。',
      version: '1',
      content:
        '# AGENTS.md\n\n## 移动端研发约定\n- 变更需覆盖 iOS 与 Android 首启场景。\n- 保留客户反馈原文并标注受影响版本。\n- 使用团队定义的验收清单。\n\n## 发布\n- 发布前确认人工放行信息。\n- 不直接修改远端仓库中的 AGENTS.md。',
    },
    {
      id: 'product-delivery',
      teamId: 'product',
      name: '产品交付',
      tag: '需求 / 验收',
      description: '需求梳理、客户反馈归集与验收结论的输出约定。',
      version: '1',
      content:
        '# AGENTS.md\n\n## 产品协作约定\n- 需求必须包含目标、范围与验收标准。\n- 客户反馈按主题与影响范围归类。\n- 验收结论标注确认人与时间。\n\n## 边界\n- 记忆保存长期约定，任务状态以对应记录为准。',
    },
  ]
}

/** 构造两个演示团队的项目记忆初始数据。 */
function seedMemories(): DemoMemory[] {
  return [
    {
      id: 'memory-permission',
      teamId: 'rd',
      projectId: 'dev-ops',
      botId: 'engineer',
      text: '权限修复需要覆盖登录后首次请求与 token 刷新两种场景。',
      source: '团队确认',
      confirmed: true,
      updated: '11月09日 14:20',
    },
    {
      id: 'memory-delivery',
      teamId: 'rd',
      projectId: 'dev-ops',
      botId: '',
      text: '提测只更新业务状态，不触发流水线；发布遵循团队人工放行流程。',
      source: '项目会议',
      confirmed: true,
      updated: '11月08日 10:10',
    },
    {
      id: 'memory-requirement',
      teamId: 'rd',
      projectId: 'dev-ops',
      botId: 'product',
      text: '需求变更需标注影响范围，并同步更新验收标准。',
      source: 'Bot 归纳',
      confirmed: false,
      updated: '今天 09:42',
    },
    {
      id: 'memory-metrics',
      teamId: 'rd',
      projectId: 'data-platform',
      botId: '',
      text: '数据口径变更必须保留旧指标版本，避免报表口径漂移。',
      source: '团队确认',
      confirmed: true,
      updated: '11月07日 16:30',
    },
    {
      id: 'memory-mobile-login',
      teamId: 'product',
      projectId: 'mobile-app',
      botId: 'mobile',
      text: '移动端登录问题优先复现 iOS 与 Android 首启两种场景。',
      source: '团队确认',
      confirmed: true,
      updated: '昨天 15:40',
    },
    {
      id: 'memory-mobile-copy',
      teamId: 'product',
      projectId: 'mobile-app',
      botId: '',
      text: '客户可见文案需经产品确认后再发布。',
      source: '产品同步',
      confirmed: false,
      updated: '11月06日 11:20',
    },
  ]
}

/** 构造两个演示团队的外部连接初始数据；凭据只保存引用名称。 */
function seedConnections(): DemoConnection[] {
  return [
    {
      id: 'github',
      teamId: 'rd',
      name: 'GitHub',
      kind: '代码平台',
      endpoint: 'github.com',
      secretRef: 'GITHUB_TOKEN',
      status: '已配置 · 未连接',
    },
    {
      id: 'gitea',
      teamId: 'rd',
      name: 'Gitea',
      kind: '代码平台',
      endpoint: 'git.example.com',
      secretRef: '',
      status: '待配置',
    },
    {
      id: 'mail',
      teamId: 'rd',
      name: '邮件通知',
      kind: '通知',
      endpoint: 'smtp.example.com',
      secretRef: 'MAIL_SMTP_SECRET',
      status: '已配置 · 未连接',
    },
    {
      id: 'product-gitea',
      teamId: 'product',
      name: 'Gitea',
      kind: '代码平台',
      endpoint: 'git.example.com',
      secretRef: 'GITEA_TOKEN',
      status: '已配置 · 未连接',
    },
    {
      id: 'feishu',
      teamId: 'product',
      name: '飞书',
      kind: '通知',
      endpoint: 'open.feishu.cn',
      secretRef: 'FEISHU_WEBHOOK',
      status: '已配置 · 未连接',
    },
    {
      id: 'product-mail',
      teamId: 'product',
      name: '邮件通知',
      kind: '通知',
      endpoint: '',
      secretRef: '',
      status: '待配置',
    },
  ]
}

/**
 * 创建全新的能力页演示数据，供首次加载与本地数据损坏时使用。
 * @returns 两个演示团队的能力目录；不读取远端或正式业务数据。
 */
export function createInitialCapabilityData(): CapabilityData {
  return {
    version: 1,
    bots: seedBots(),
    runs: seedRuns(),
    skills: seedSkills(),
    templates: seedTemplates(),
    memories: seedMemories(),
    connections: seedConnections(),
    projectTemplates: {
      'dev-ops': 'team-default',
      'data-platform': 'service-team',
      'mobile-app': 'mobile-team',
      'ops-console': 'team-default',
    },
  }
}

/**
 * 判断未知值是否为可读取的属性记录。
 * @param value 从本地存储或调用方传入的未知值。
 * @returns 是否为非数组对象。
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 校验字符串数组，避免损坏的本地数据进入页面。 */
function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

/** 校验智能体记录的必要字段。 */
function isDemoBot(value: unknown): value is DemoBot {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.teamId === 'string' &&
    typeof value.name === 'string' &&
    typeof value.role === 'string' &&
    typeof value.owner === 'string' &&
    botRuntimes.some((runtime) => runtime === value.runtime) &&
    typeof value.model === 'string' &&
    typeof value.instructions === 'string' &&
    isStringArray(value.skills) &&
    isStringArray(value.projectIds) &&
    typeof value.enabled === 'boolean' &&
    typeof value.online === 'boolean' &&
    typeof value.lastActive === 'string'
  )
}

/** 校验智能体运行记录的必要字段。 */
function isDemoBotRun(value: unknown): value is DemoBotRun {
  if (!isRecord(value)) return false
  const result = value.result
  return (
    typeof value.id === 'string' &&
    typeof value.botId === 'string' &&
    typeof value.projectId === 'string' &&
    typeof value.title === 'string' &&
    typeof value.time === 'string' &&
    (result === '已完成' || result === '受阻' || result === '运行环境离线')
  )
}

/** 校验 Skill 记录的必要字段。 */
function isDemoSkill(value: unknown): value is DemoSkill {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.teamId === 'string' &&
    typeof value.name === 'string' &&
    skillCategories.some((category) => category === value.category) &&
    typeof value.description === 'string' &&
    typeof value.instructions === 'string' &&
    typeof value.version === 'string' &&
    typeof value.source === 'string' &&
    typeof value.enabled === 'boolean'
  )
}

/** 校验 AGENTS.md 模板记录的必要字段。 */
function isDemoAgentTemplate(value: unknown): value is DemoAgentTemplate {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.teamId === 'string' &&
    typeof value.name === 'string' &&
    typeof value.tag === 'string' &&
    typeof value.description === 'string' &&
    typeof value.content === 'string' &&
    typeof value.version === 'string'
  )
}

/** 校验记忆记录的必要字段。 */
function isDemoMemory(value: unknown): value is DemoMemory {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.teamId === 'string' &&
    typeof value.projectId === 'string' &&
    typeof value.botId === 'string' &&
    typeof value.text === 'string' &&
    typeof value.source === 'string' &&
    typeof value.confirmed === 'boolean' &&
    typeof value.updated === 'string'
  )
}

/** 校验连接记录的必要字段。 */
function isDemoConnection(value: unknown): value is DemoConnection {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.teamId === 'string' &&
    typeof value.name === 'string' &&
    typeof value.kind === 'string' &&
    typeof value.endpoint === 'string' &&
    typeof value.secretRef === 'string' &&
    connectionStatuses.some((status) => status === value.status)
  )
}

/**
 * 将未知数组逐项校验为指定类型。
 * @param value 待校验的未知值。
 * @param guard 单条记录的类型守卫。
 * @returns 全部记录合法时返回类型化数组，否则返回 null。
 */
function toRecordArray<T>(value: unknown, guard: (item: unknown) => item is T): T[] | null {
  if (!Array.isArray(value)) return null
  const records: T[] = []
  for (const item of value) {
    if (!guard(item)) return null
    records.push(item)
  }
  return records
}

/**
 * 校验浏览器中保存的能力演示数据。
 * @param value 从 localStorage 解析出的未知值。
 * @returns 结构可识别时返回演示数据，否则返回 null。
 */
function readStoredCapabilityData(value: unknown): CapabilityData | null {
  if (!isRecord(value) || value.version !== 1) return null
  const bots = toRecordArray(value.bots, isDemoBot)
  const runs = toRecordArray(value.runs, isDemoBotRun)
  const skills = toRecordArray(value.skills, isDemoSkill)
  const templates = toRecordArray(value.templates, isDemoAgentTemplate)
  const memories = toRecordArray(value.memories, isDemoMemory)
  const connections = toRecordArray(value.connections, isDemoConnection)
  if (!bots || !runs || !skills || !templates || !memories || !connections) return null
  if (!isRecord(value.projectTemplates)) return null
  const projectTemplates: Record<string, string> = {}
  for (const [projectId, templateId] of Object.entries(value.projectTemplates)) {
    if (typeof templateId !== 'string') return null
    projectTemplates[projectId] = templateId
  }
  return { version: 1, bots, runs, skills, templates, memories, connections, projectTemplates }
}

/**
 * 从本地存储读取能力演示数据；不可识别时回退初始数据。
 * @returns 可安全渲染的能力数据。
 */
function loadCapabilityData(): CapabilityData {
  try {
    const raw = localStorage.getItem(CAPABILITY_STORAGE_KEY)
    if (!raw) return createInitialCapabilityData()
    const parsed: unknown = JSON.parse(raw)
    return readStoredCapabilityData(parsed) ?? createInitialCapabilityData()
  } catch {
    return createInitialCapabilityData()
  }
}

/** 能力页数据读取与更新接口。 */
export interface CapabilityStore {
  data: CapabilityData
  updateData: (updater: (current: CapabilityData) => CapabilityData) => void
}

/**
 * 读取并持久化能力页演示数据。
 * @param notify 可选提示函数；本地存储写入失败时用于告知修改不会被保存。
 * @returns 当前能力数据与不可变更新函数。
 */
export function useCapabilityData(notify?: (message: string) => void): CapabilityStore {
  const [data, setData] = useState<CapabilityData>(loadCapabilityData)

  useEffect(() => {
    try {
      localStorage.setItem(CAPABILITY_STORAGE_KEY, JSON.stringify(data))
    } catch {
      notify?.('本地存储不可用，本次能力修改仅在当前页面保留。')
    }
  }, [data, notify])

  const updateData = useCallback((updater: (current: CapabilityData) => CapabilityData) => {
    setData((current) => updater(current))
  }, [])

  return { data, updateData }
}

/**
 * 生成本地新增记录的稳定标识。
 * @param prefix 记录类型前缀，例如 bot、memory。
 * @returns 前缀加时间戳与随机后缀的唯一标识。
 */
export function createLocalId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

/**
 * 生成与既有原型一致的中文本地时间文本。
 * @returns 例如 2026/11/10 09:30:00 的展示文本。
 */
export function currentTimestamp(): string {
  return new Date().toLocaleString('zh-CN')
}

/**
 * 复制纯文本到剪贴板。
 * @param text 待复制内容。
 * @returns 浏览器允许复制时为 true；拒绝权限时返回 false 由页面提示手动复制。
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

/**
 * 下载浏览器内生成的纯文本文件，不访问远端服务。
 * @param filename 下载文件名。
 * @param content 文本内容。
 * @returns 无返回值；下载链接触发后立即释放临时对象地址。
 */
export function downloadTextFile(filename: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
