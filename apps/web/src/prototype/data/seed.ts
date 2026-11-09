import type { DemoItem, DemoProject, DemoTeam, PrototypeData } from './types'

/** 原型中的演示成员，与真实团队成员无关。 */
export const demoMembers = ['林然', '陈悦', '周宁', '许嘉'] as const

/** 原型中的团队列表。 */
const teams: DemoTeam[] = [
  { id: 'rd', name: '研发团队', initial: '研' },
  { id: 'product', name: '产品团队', initial: '产' },
]

/** 原型中的项目列表，覆盖进行中、暂停与无事项场景。 */
const projects: DemoProject[] = [
  {
    id: 'dev-ops',
    teamId: 'rd',
    name: '研发协作平台',
    repo: 'team/dev-ops',
    provider: 'GitHub',
    visibility: '私有',
    status: '进行中',
    owner: '林然',
    description: '面向内部团队的研发协作与交付平台。',
    services: ['Web', 'API'],
    updatedAt: '今天 10:24',
  },
  {
    id: 'data-platform',
    teamId: 'rd',
    name: '数据平台',
    repo: 'team/data-platform',
    provider: 'Gitea',
    visibility: '私有',
    status: '进行中',
    owner: '陈悦',
    description: '统一指标、报表与数据同步能力。',
    services: ['API', 'Worker'],
    updatedAt: '昨天 18:10',
  },
  {
    id: 'mobile-app',
    teamId: 'product',
    name: '客户应用',
    repo: 'team/mobile-app',
    provider: 'Gitea',
    visibility: '私有',
    status: '进行中',
    owner: '周宁',
    description: '面向客户的移动端应用。',
    services: ['iOS', 'Android'],
    updatedAt: '昨天 15:40',
  },
  {
    id: 'ops-console',
    teamId: 'product',
    name: '运维控制台',
    repo: 'team/ops-console',
    provider: 'GitHub',
    visibility: '私有',
    status: '暂停',
    owner: '许嘉',
    description: '服务运行状态与变更操作入口。',
    services: ['Web'],
    updatedAt: '11月06日',
  },
]

/**
 * 构造用于重置的原型演示事项。
 * @returns 独立的事项数组；不读取远端或真实业务数据。
 */
function seedItems(): DemoItem[] {
  const rows: Array<[string, string, string, string, string, string, string]> = [
    ['PRD-024', '统一接口错误处理', '需求', '林然', '开发中', '陈悦', '42'],
    ['PRD-026', '增加客户反馈入口', '需求', '周宁', '待测试', '陈悦', '39'],
    ['PRD-021', '完善项目成员管理', '需求', '林然', '测试中', '许嘉', '38'],
    ['PRD-028', '优化需求筛选', '需求', '陈悦', '开发中', '林然', '46'],
    ['PRD-029', '补充测试交付说明', '需求', '周宁', '待处理', '许嘉', ''],
    ['PRD-031', '支持多环境配置', '需求', '林然', '测试通过', '陈悦', ''],
    ['BUG-018', '登录后权限未刷新', 'Bug', '陈悦', '修复中', '林然', '45'],
    ['BUG-015', '客户反馈附件丢失', 'Bug', '周宁', '待回归', '许嘉', '41'],
    ['BUG-012', '筛选条件刷新后丢失', 'Bug', '林然', '已解决', '陈悦', ''],
  ]
  const items: DemoItem[] = rows.map(([id, title, kind, owner, status, tester, pr]) => ({
    id,
    projectId: 'dev-ops',
    kind: kind as DemoItem['kind'],
    title,
    owner,
    collaborators: '陈悦',
    tester,
    status,
    pr,
    description:
      id === 'PRD-024'
        ? '统一接口错误响应与前端提示，保留现有状态码。\n\n覆盖登录、项目管理与成员权限场景，补充兼容性说明及失败路径验证。'
        : `记录「${title}」的处理过程、验收说明与代码关联。`,
    branch: id === 'PRD-024' ? 'feat/error-handling' : 'feat/project-updates',
    external: '',
    comments: [
      { id: `${id}-c1`, author: '林然', text: '请补充兼容性说明，确认后交给测试。', time: '11月09日 14:20' },
      {
        id: `${id}-c2`,
        author: '项目助手',
        text: '已汇总关联 PR 与变更记录，可查看项目交付信息。',
        time: '11月09日 14:35',
        bot: true,
      },
    ],
    activity: ['示例记录：研发已关联代码变更。'],
    requirementId:
      id === 'BUG-018' || id === 'BUG-015' || id === 'BUG-012' ? (id === 'BUG-018' ? 'PRD-024' : 'PRD-021') : undefined,
  }))
  items.push({
    id: 'PRD-008',
    projectId: 'mobile-app',
    kind: '需求',
    title: '完善移动端登录体验',
    owner: '周宁',
    collaborators: '林然',
    tester: '',
    status: '测试通过',
    pr: '12',
    description: '记录移动端登录流程的验收说明与代码关联。',
    branch: 'feat/mobile-login',
    external: '',
    comments: [],
    activity: [],
  })
  return items
}

/**
 * 创建全新的原型初始状态，供首次加载与重置使用。
 * @returns 版本化的演示数据；不访问后端或浏览器存储。
 */
export function createInitialData(): PrototypeData {
  return {
    version: 1,
    currentTeamId: 'rd',
    currentProjectId: 'dev-ops',
    currentRole: '管理员',
    teams,
    projects,
    items: seedItems(),
  }
}
