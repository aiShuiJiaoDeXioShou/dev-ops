/** 协作原型中的 Bot 运行环境；与真实执行节点无关。 */
export type CollaborationRuntime = '团队执行器' | '本地节点'

/** 协作原型中的 Bot 成员，只保存会话展示所需字段。 */
export interface CollaborationBot {
  id: string
  name: string
  /** 业务角色，例如需求与验收助手。 */
  role: string
  model: string
  runtime: CollaborationRuntime
  online: boolean
  /** 业务负责人。 */
  owner: string
}

/** 会话消息；用户消息右对齐，Bot 回复左对齐。 */
export interface CollaborationMessage {
  id: string
  author: string
  from: 'user' | 'bot'
  text: string
  time: string
  /** 标记由页面本地脚本生成的模拟回复，不代表模型输出。 */
  simulated?: boolean
}

/** 会话内折叠展示的任务与工具活动记录。 */
export interface CollaborationActivity {
  id: string
  label: string
  detail: string
  time: string
}

/** 会话类型：独立 Bot 直接会话或群组会话。 */
export type CollaborationRoomKind = 'direct' | 'group'

/** 会话记录；成员、项目引用与标签只影响本地展示。 */
export interface CollaborationRoom {
  id: string
  name: string
  kind: CollaborationRoomKind
  leaderId: string
  memberIds: string[]
  /** 项目引用不自动授予项目工具权限。 */
  projectIds: string[]
  topicTags: string[]
  unreadCount: number
  messages: CollaborationMessage[]
  activity: CollaborationActivity[]
}

/** 协作任务执行阶段；与业务事项状态分别维护。 */
export type TaskPhase = '待开始' | '进行中' | '待验收' | '已完成' | '受阻'

/** 待你处理列表关注的任务阶段。 */
export const pendingTaskPhases: TaskPhase[] = ['待开始', '待验收', '受阻']

/** 任务来源；新建任务时由用户显式选择。 */
export type TaskSource = '对话' | '日志事件' | '定时巡检' | '事项跟进'

/** 新建任务可选的来源顺序。 */
export const taskSources: TaskSource[] = ['对话', '日志事件', '定时巡检', '事项跟进']

/** 任务目标环境；与项目环境变量使用同一组取值。 */
export type TaskEnvironment = '开发' | '测试' | '生产'

/** 协作任务；原型中由页面本地状态推进，不写入后端。 */
export interface CollaborationTask {
  id: string
  roomId: string
  /** 目标项目；空字符串表示未绑定项目的通用任务。 */
  projectId: string
  /** 关联需求或 Bug 编号；空字符串表示未关联。 */
  issueId: string
  title: string
  /** 业务负责人。 */
  owner: string
  /** 执行者 Bot 标识。 */
  executorId: string
  phase: TaskPhase
  environment: TaskEnvironment
  source: TaskSource
  note: string
  /** 交接记录，按时间正序追加。 */
  events: string[]
  /** 引用文本，例如 @repo/team/dev-ops。 */
  references: string[]
}

/** `@` 引用候选类型。 */
export type MentionType = 'Bot' | '项目' | '文件' | 'PR' | '事项' | 'Skill'

/** `@` 引用候选项；token 会原样插入输入框。 */
export interface MentionCandidate {
  token: string
  type: MentionType
  description: string
}

/** 协作原型中的演示 Bot 成员，与真实团队智能体无关。 */
export const collaborationBots: CollaborationBot[] = [
  {
    id: 'pm',
    name: '项目助手',
    role: '需求与验收助手',
    model: 'DeepSeek',
    runtime: '团队执行器',
    online: true,
    owner: '林然',
  },
  {
    id: 'engineer',
    name: '小林',
    role: '研发助手',
    model: '默认模型',
    runtime: '团队执行器',
    online: true,
    owner: '林然',
  },
  {
    id: 'delivery',
    name: '小渡',
    role: '交付助手',
    model: '默认模型',
    runtime: '本地节点',
    online: false,
    owner: '陈悦',
  },
  {
    id: 'mobile',
    name: '星野',
    role: '移动端助手',
    model: '默认模型',
    runtime: '团队执行器',
    online: true,
    owner: '周宁',
  },
]

/** 默认打开的会话；研发协作平台协作组包含任务面板示例。 */
export const defaultCollaborationRoomId = 'group-dev-ops'

/** 协作原型的会话列表，覆盖直接会话与群组、未读和折叠活动。 */
export const collaborationRooms: CollaborationRoom[] = [
  {
    id: 'group-dev-ops',
    name: '研发协作平台协作组',
    kind: 'group',
    leaderId: 'pm',
    memberIds: ['pm', 'engineer', 'delivery'],
    projectIds: ['dev-ops'],
    topicTags: ['研发协作', '异常排查'],
    unreadCount: 0,
    messages: [
      {
        id: 'msg-dev-ops-1',
        author: '项目助手',
        from: 'bot',
        text: '登录异常已建立排查任务。小林负责分析，林然负责验收。开发交付后，我会核对发布条件。',
        time: '09:42',
      },
      {
        id: 'msg-dev-ops-2',
        author: '林然',
        from: 'user',
        text: '@小林 先确认 token 刷新与权限缓存的关系，有结论在任务里同步。',
        time: '09:46',
      },
      {
        id: 'msg-dev-ops-3',
        author: '小林',
        from: 'bot',
        text: '已读取 @repo/team/dev-ops 的认证模块。初步判断权限缓存未在 token 刷新后失效，计划补充两类回归场景。',
        time: '09:52',
      },
      {
        id: 'msg-dev-ops-4',
        author: '林然',
        from: 'user',
        text: '把结论整理到 BUG-018，并同步给测试。',
        time: '09:55',
      },
      {
        id: 'msg-dev-ops-5',
        author: '项目助手',
        from: 'bot',
        text: '已更新任务「排查登录后权限未刷新」的交接记录，关联 BUG-018 与 PR #45。',
        time: '09:56',
      },
    ],
    activity: [
      {
        id: 'act-dev-ops-1',
        label: '日志告警聚合',
        detail: 'AUTH_STALE · 5 分钟内 12 次登录权限异常，已建立 BUG-018。',
        time: '09:40',
      },
      {
        id: 'act-dev-ops-2',
        label: '任务状态更新',
        detail: '「排查登录后权限未刷新」由项目助手交给小林执行。',
        time: '09:42',
      },
      {
        id: 'act-dev-ops-3',
        label: '项目工具调用',
        detail: '读取 team/dev-ops · src/api.ts（本地示例，无远端调用）。',
        time: '09:52',
      },
    ],
  },
  {
    id: 'direct-project-assistant',
    name: '项目助手',
    kind: 'direct',
    leaderId: 'pm',
    memberIds: ['pm'],
    projectIds: [],
    topicTags: ['需求梳理'],
    unreadCount: 2,
    messages: [
      {
        id: 'msg-pm-1',
        author: '项目助手',
        from: 'bot',
        text: '早上好。今天有 2 条待验收、1 条受阻任务，需要我先整理 PRD-024 的验收说明吗？',
        time: '09:12',
      },
      {
        id: 'msg-pm-2',
        author: '林然',
        from: 'user',
        text: '先看 PRD-024，统一接口错误处理还差兼容性说明。',
        time: '09:14',
      },
      {
        id: 'msg-pm-3',
        author: '项目助手',
        from: 'bot',
        text: '已找到关联讨论与 @file/docs/prd/mvp.md。可以生成一版兼容性说明草稿，发布前仍需人工确认。',
        time: '09:15',
      },
    ],
    activity: [
      {
        id: 'act-pm-1',
        label: '验收待办摘要',
        detail: '汇总 PRD-024 与 PRD-031 的验收条件（本地示例）。',
        time: '09:12',
      },
    ],
  },
  {
    id: 'direct-engineer',
    name: '小林',
    kind: 'direct',
    leaderId: 'engineer',
    memberIds: ['engineer'],
    projectIds: ['dev-ops'],
    topicTags: ['代码评审'],
    unreadCount: 3,
    messages: [
      {
        id: 'msg-engineer-1',
        author: '小林',
        from: 'bot',
        text: 'PR #46 的评审意见已整理，主要涉及筛选条件默认值。',
        time: '09:20',
      },
      {
        id: 'msg-engineer-2',
        author: '林然',
        from: 'user',
        text: '按现有约定处理，周三前合入。',
        time: '09:24',
      },
      {
        id: 'msg-engineer-3',
        author: '小林',
        from: 'bot',
        text: '收到。合入前会补一条边界用例，并在任务里同步。',
        time: '09:25',
      },
    ],
    activity: [
      { id: 'act-engineer-1', label: 'PR 评审摘要', detail: 'PR #46 · 优化需求筛选（本地示例）。', time: '09:20' },
    ],
  },
  {
    id: 'group-mobile',
    name: '客户应用协作组',
    kind: 'group',
    leaderId: 'mobile',
    memberIds: ['mobile'],
    projectIds: ['mobile-app'],
    topicTags: ['需求评审'],
    unreadCount: 1,
    messages: [
      {
        id: 'msg-mobile-1',
        author: '星野',
        from: 'bot',
        text: 'PRD-008 移动端登录体验已完成验收，客户应用协作组今天没有阻塞事项。',
        time: '昨天 17:05',
      },
      {
        id: 'msg-mobile-2',
        author: '林然',
        from: 'user',
        text: '下次迭代关注客户反馈入口的埋点。',
        time: '昨天 17:12',
      },
      {
        id: 'msg-mobile-3',
        author: '星野',
        from: 'bot',
        text: '已记录，会在需求梳理时补充埋点口径。',
        time: '昨天 17:13',
      },
    ],
    activity: [],
  },
]

/** 协作原型的任务；状态与业务事项状态分别维护。 */
export const collaborationTasks: CollaborationTask[] = [
  {
    id: 'task-login',
    roomId: 'group-dev-ops',
    projectId: 'dev-ops',
    issueId: 'BUG-018',
    title: '排查登录后权限未刷新',
    owner: '林然',
    executorId: 'engineer',
    phase: '进行中',
    environment: '测试',
    source: '日志事件',
    note: '登录后出现旧权限，核对 token 刷新与权限缓存；示例结论与日志均为本地演示数据。',
    events: [
      '09:40 · 日志异常聚合为一个问题',
      '09:42 · 项目助手交给小林排查',
      '10:05 · 小林确认权限缓存未在 token 刷新后失效',
    ],
    references: ['@repo/team/dev-ops', '@BUG-018', '@file/src/api.ts'],
  },
  {
    id: 'task-prd024',
    roomId: 'group-dev-ops',
    projectId: 'dev-ops',
    issueId: 'PRD-024',
    title: '统一接口错误处理 · 验收说明',
    owner: '林然',
    executorId: 'pm',
    phase: '待验收',
    environment: '测试',
    source: '对话',
    note: '补充兼容性说明与失败路径验证，验收通过后才更新关联需求状态。',
    events: ['10:20 · 项目助手已提交兼容性说明', '10:26 · 等待林然验收'],
    references: ['@PRD-024', '@pr/45', '@file/docs/prd/mvp.md'],
  },
  {
    id: 'task-mobile',
    roomId: 'group-mobile',
    projectId: 'mobile-app',
    issueId: '',
    title: '整理客户反馈入口埋点口径',
    owner: '周宁',
    executorId: 'mobile',
    phase: '待开始',
    environment: '开发',
    source: '对话',
    note: '梳理客户反馈入口的事件名、触发时机与验证方式。',
    events: ['昨天 17:10 · 已建立任务'],
    references: ['@project/mobile-app'],
  },
  {
    id: 'task-release',
    roomId: 'group-dev-ops',
    projectId: 'dev-ops',
    issueId: '',
    title: '生成测试环境发布核对清单',
    owner: '陈悦',
    executorId: 'delivery',
    phase: '受阻',
    environment: '测试',
    source: '定时巡检',
    note: '等待本地节点恢复后再生成发布核对清单；原型不执行真实部署。',
    events: ['08:50 · 执行节点离线，任务受阻'],
    references: ['@project/dev-ops', '@skill/交付摘要'],
  },
]

/** `@` 输入可插入的本地引用候选，覆盖 Bot、项目、文件、PR、事项与 Skill。 */
export const mentionCandidates: MentionCandidate[] = [
  { token: '@项目助手', type: 'Bot', description: '需求与验收助手 · 在线' },
  { token: '@小林', type: 'Bot', description: '研发助手 · 在线' },
  { token: '@小渡', type: 'Bot', description: '交付助手 · 本地节点离线' },
  { token: '@星野', type: 'Bot', description: '移动端助手 · 在线' },
  { token: '@project/dev-ops', type: '项目', description: '研发协作平台' },
  { token: '@project/mobile-app', type: '项目', description: '客户应用' },
  { token: '@file/docs/prd/mvp.md', type: '文件', description: 'MVP 需求文档' },
  { token: '@file/src/api.ts', type: '文件', description: '接口请求与错误处理' },
  { token: '@pr/45', type: 'PR', description: 'BUG-018 关联 PR · 待审核' },
  { token: '@PRD-024', type: '事项', description: '统一接口错误处理 · 开发中' },
  { token: '@BUG-018', type: '事项', description: '登录后权限未刷新 · 修复中' },
  { token: '@skill/交付摘要', type: 'Skill', description: '汇总变更与测试结果' },
]

/** 各会话的本地模拟回复池；发送消息后由页面脚本随机顺序取用。 */
export const demoBotReplies: Record<string, string[]> = {
  'group-dev-ops': [
    '收到。我会把这条补充到任务「排查登录后权限未刷新」的交接记录里，并提醒小林同步回归结论。',
    '已记录。当前关联 PRD-024 与 PR #45，验收前还需要补充兼容性说明。',
    '了解。原型中不会更新远端事项或 Git 记录，这里只演示本地会话与任务联动。',
  ],
  'direct-project-assistant': [
    '收到。我先整理一条执行摘要，供你确认后再写入任务记录。',
    '已记录。需要我把它转成协作任务吗？可以在底部「新建任务」中填写执行者与来源。',
  ],
  'direct-engineer': [
    '收到，我会在 PR #46 合入前补充边界用例。',
    '已记录评审结论；原型不读取真实仓库，这条回复由本地脚本模拟。',
  ],
  'group-mobile': [
    '收到，我会在需求梳理时补充客户反馈入口的埋点口径。',
    '已记录到客户应用协作组；正式实现会同步到项目需求记录。',
  ],
}
