/** 运维原型中的部署环境，与真实环境完全隔离。 */
export type DemoEnvironment = '开发' | '测试' | '生产'

/** 环境展示顺序，供筛选与表单复用。 */
export const demoEnvironments: DemoEnvironment[] = ['开发', '测试', '生产']

/** 服务健康状态；只表达演示数据，不代表真实探活结果。 */
export type ServiceHealth = '正常' | '异常'

/** 接入演示连接的服务及其测试/生产运行版本。 */
export interface DemoService {
  id: string
  projectId: string
  name: string
  environment: DemoEnvironment
  version: string
  health: ServiceHealth
  /** 数据采集时间，多为相对时间文案。 */
  collectedAt: string
  /** 采集来源，说明数据由哪个演示连接提供。 */
  source: string
}

/** 运行事件处理状态；用于列表状态点，不驱动真实工单。 */
export type IncidentStatus = '待处理' | '排查中' | '已解决'

/** 运行事件；同类错误按指纹聚合成一条，只累计次数。 */
export interface DemoIncident {
  id: string
  /** 去重指纹：同项目、环境与错误类型只建立一条事件。 */
  fingerprint: string
  projectId: string
  title: string
  environment: DemoEnvironment
  /** 聚合次数；重复演示同一异常时递增。 */
  count: number
  occurredAt: string
  /** 证据来源说明，例如采集位置与时间范围。 */
  evidenceSource: string
  /** 证据正文，展示示例日志摘要。 */
  evidence: string
  status: IncidentStatus
  /** 自动建立的排查任务标题，仅用于展示与跳转说明。 */
  taskTitle: string
  /** 承接排查的 Bot 名称。 */
  assignee: string
  /** 关联业务事项编号；空字符串表示未关联。 */
  issueId: string
}

/** 演示日志异常使用的固定指纹，与初始事件一致，便于聚合同类事件。 */
export const demoIncidentFingerprint = 'dev-ops:测试:AUTH_STALE'

/** 值守规则类型；日志告警聚合事件，定时巡检生成核对任务。 */
export type WatchRuleType = '日志告警' | '定时巡检'

/** 值守规则；页面关闭后原型不包含后台调度。 */
export interface DemoWatchRule {
  id: string
  projectId: string
  name: string
  type: WatchRuleType
  /** 触发频率或时间，例如「每 5 分钟」「每天 09:00」。 */
  frequency: string
  environment: DemoEnvironment
  /** 执行规则的 Bot 名称。 */
  botName: string
  /** 执行 Bot 是否在线；离线时模拟触发会被拦截。 */
  botOnline: boolean
  /** 触发条件、检查范围与动作说明。 */
  condition: string
  enabled: boolean
  lastTriggered: string
}

/** 变更计划类型，部署、数据库、清理和云资源共用同一流程。 */
export type ChangeKind = '部署版本' | '数据库变更' | '服务器清理' | '云资源调整'

/** 变更类型展示顺序，供新建表单复用。 */
export const changeKinds: ChangeKind[] = ['部署版本', '数据库变更', '服务器清理', '云资源调整']

/** 变更流程阶段；失败后核对状态可重试，执行前可取消。 */
export type ChangePhase = '待确认' | '已批准' | '执行中' | '待验证' | '已完成' | '失败'

/** 正常流程的阶段顺序，用于详情进度展示（失败单独标记）。 */
export const changePhaseOrder: ChangePhase[] = ['待确认', '已批准', '执行中', '待验证', '已完成']

/** 变更计划；不连接服务器、不执行 SQL 或删除文件。 */
export interface DemoChangePlan {
  id: string
  projectId: string
  kind: ChangeKind
  /** 服务、数据表、目录或云资源名称。 */
  target: string
  environment: DemoEnvironment
  /** 版本或迁移编号。 */
  version: string
  /** 变更范围与执行步骤。 */
  scope: string
  /** 核对依据，例如提交、测试结果或影响范围。 */
  evidence: string
  /** 恢复方案；不可回滚时说明处理办法。 */
  rollback: string
  phase: ChangePhase
  updatedAt: string
  operator: string
}

/** 运行概况中的服务卡片；测试与生产版本分别展示。 */
export const demoServices: DemoService[] = [
  {
    id: 'api-test',
    projectId: 'dev-ops',
    name: 'API',
    environment: '测试',
    version: 'v0.5.2-build.17',
    health: '异常',
    collectedAt: '今天 09:40',
    source: '日志服务 · 测试集群',
  },
  {
    id: 'api-prod',
    projectId: 'dev-ops',
    name: 'API',
    environment: '生产',
    version: 'v0.5.1',
    health: '正常',
    collectedAt: '今天 09:38',
    source: '运行探活 · 生产集群',
  },
  {
    id: 'web-test',
    projectId: 'dev-ops',
    name: 'Web',
    environment: '测试',
    version: 'v0.4.2-build.17',
    health: '正常',
    collectedAt: '今天 09:38',
    source: '运行探活 · 测试集群',
  },
  {
    id: 'web-prod',
    projectId: 'dev-ops',
    name: 'Web',
    environment: '生产',
    version: 'v0.4.1',
    health: '正常',
    collectedAt: '今天 09:36',
    source: '运行探活 · 生产集群',
  },
]

/** 运行事件初始示例；重复演示同类异常时只增加聚合次数。 */
export const demoIncidents: DemoIncident[] = [
  {
    id: 'event-auth-stale',
    fingerprint: demoIncidentFingerprint,
    projectId: 'dev-ops',
    title: 'AUTH_STALE · 登录权限异常',
    environment: '测试',
    count: 3,
    occurredAt: '今天 09:40',
    evidenceSource: '日志服务 · 测试集群 · 09:30–09:40 采集；按指纹聚合 3 次同类事件。',
    evidence: '示例日志：权限缓存版本与 token 不一致，5 分钟内出现 12 次登录权限异常（AUTH_STALE）。',
    status: '待处理',
    taskTitle: '排查登录后权限未刷新',
    assignee: '小林',
    issueId: 'BUG-018',
  },
]

/**
 * 构造「演示一次日志异常」新建的事件。
 * @returns 与初始事件同指纹的待处理事件；重复创建时页面按指纹聚合次数。
 */
export function createDemoIncident(projectId = 'dev-ops'): DemoIncident {
  return {
    id: `event-${Date.now()}`,
    fingerprint: `${projectId}:测试:AUTH_STALE`,
    projectId,
    title: 'AUTH_STALE · 登录权限异常',
    environment: '测试',
    count: 1,
    occurredAt: '刚刚',
    evidenceSource: '日志服务 · 测试集群 · 刚刚采集；按指纹聚合同类事件。',
    evidence: '示例日志：权限缓存版本与 token 不一致，5 分钟内出现 12 次登录权限异常（AUTH_STALE）。',
    status: '待处理',
    taskTitle: '排查登录后权限未刷新',
    assignee: '小林',
    issueId: 'BUG-018',
  }
}

/** 值守规则初始示例；开关与触发结果只保存在本地页面状态。 */
export const demoWatchRules: DemoWatchRule[] = [
  {
    id: 'watch-login',
    projectId: 'dev-ops',
    name: 'API 登录异常巡检',
    type: '日志告警',
    frequency: '每 5 分钟',
    environment: '测试',
    botName: '小林',
    botOnline: true,
    condition: '同类错误 5 分钟内超过 10 次时聚合，并建立一条排查任务与通知。',
    enabled: true,
    lastTriggered: '今天 09:40',
  },
  {
    id: 'watch-disk',
    projectId: 'dev-ops',
    name: '服务器磁盘巡检',
    type: '定时巡检',
    frequency: '每天 09:00',
    environment: '生产',
    botName: '小渡',
    botOnline: false,
    condition: '检查磁盘与缓存占用，超过 80% 时生成清理建议；执行 Bot 离线时任务受阻。',
    enabled: false,
    lastTriggered: '尚未演示触发',
  },
  {
    id: 'watch-release',
    projectId: 'mobile-app',
    name: '发布版本核对',
    type: '定时巡检',
    frequency: '每次变更完成后',
    environment: '生产',
    botName: '项目助手',
    botOnline: true,
    condition: '变更验证通过后核对运行版本与健康状态，发现不一致时建立异常事件。',
    enabled: true,
    lastTriggered: '昨天 18:20',
  },
]

/** 变更记录初始示例，覆盖待确认、已批准、执行中、待验证、已完成与失败。 */
export const demoChangePlans: DemoChangePlan[] = [
  {
    id: 'op-api-prod',
    projectId: 'dev-ops',
    kind: '部署版本',
    target: 'API',
    environment: '生产',
    version: 'v0.5.1',
    scope: '发布 v0.5.1 到生产环境，先灰度 API 与 Web，健康检查通过后全量。',
    evidence: 'PR #46 已合并；测试环境 v0.5.2-build.17 通过回归，错误率恢复到基线。',
    rollback: '保留 v0.5.0 镜像，异常时回滚并重新执行健康检查与登录验证。',
    phase: '待验证',
    updatedAt: '今天 10:12',
    operator: '林然',
  },
  {
    id: 'op-migration-test',
    projectId: 'dev-ops',
    kind: '数据库变更',
    target: 'project_member 索引',
    environment: '测试',
    version: 'migration-20261108',
    scope: '新增项目成员查询索引，分批回填历史数据；每批 2000 行，执行后核对受影响行数。',
    evidence: '影响 2 张表，约 1.2 万行；测试环境已用 EXPLAIN 校验查询计划。',
    rollback: '删除新增索引并恢复旧字段默认值；回填范围可按批次标记回滚。',
    phase: '执行中',
    updatedAt: '今天 09:55',
    operator: '陈悦',
  },
  {
    id: 'op-cache-clean',
    projectId: 'dev-ops',
    kind: '服务器清理',
    target: '构建缓存目录',
    environment: '测试',
    version: 'build-cache-1120',
    scope: '清理 30 天前的构建缓存目录，保留最近 3 个版本产物；清理前生成文件清单。',
    evidence: '测试环境磁盘占用 82%，清理范围已与研发确认。',
    rollback: '删除后不可恢复；执行前已生成备份清单，可按清单重新下载构建产物。',
    phase: '已批准',
    updatedAt: '昨天 18:30',
    operator: '许嘉',
  },
  {
    id: 'op-redis-test',
    projectId: 'dev-ops',
    kind: '云资源调整',
    target: '测试环境 Redis',
    environment: '测试',
    version: 'redis-4c8g',
    scope: '测试环境 Redis 扩容至 4C8G，变更窗口 22:00–23:00，完成后验证连接数与内存占用。',
    evidence: '压测峰值连接数接近当前上限，扩容方案已与平台组评估。',
    rollback: '缩回 2C4G 并恢复告警阈值；扩容费用按云平台计费规则结算。',
    phase: '待确认',
    updatedAt: '今天 08:20',
    operator: '周宁',
  },
  {
    id: 'op-mobile-prod',
    projectId: 'mobile-app',
    kind: '数据库变更',
    target: 'customer_feedback 表',
    environment: '生产',
    version: 'migration-20261105',
    scope: '新增客户反馈埋点字段，分批回填历史空值；回填期间只读查询。',
    evidence: '迁移脚本已在小规模数据验证，影响约 8000 行；核对校验和通过。',
    rollback: '删除新增字段并恢复默认值；回填数据保留审计记录。',
    phase: '已完成',
    updatedAt: '11月08日',
    operator: '许嘉',
  },
  {
    id: 'op-log-archive',
    projectId: 'dev-ops',
    kind: '服务器清理',
    target: '生产日志归档',
    environment: '生产',
    version: 'log-archive-1107',
    scope: '归档 90 天前的应用日志到对象存储，保留最近 30 天可检索日志。',
    evidence: '归档清单已生成，但校验和缺失，无法核对归档完整性。',
    rollback: '归档失败不删除源日志；核对通过前保持源文件只读。',
    phase: '失败',
    updatedAt: '11月07日',
    operator: '陈悦',
  },
]
