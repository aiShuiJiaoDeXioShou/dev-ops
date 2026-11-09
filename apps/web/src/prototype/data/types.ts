/** 原型演示中的团队角色，与产品最终角色同名但不代表真实鉴权。 */
export type TeamRole = '管理员' | '开发者' | '浏览者'

/** 原型中的团队，仅保存展示与切换所需的最小字段。 */
export interface DemoTeam {
  id: string
  name: string
  initial: string
}

/** 原型中的项目，字段对齐产品项目列表与项目工作区。 */
export interface DemoProject {
  id: string
  teamId: string
  name: string
  repo: string
  provider: 'GitHub' | 'Gitea'
  visibility: '私有' | '公开'
  status: '进行中' | '暂停' | '已结束'
  owner: string
  description: string
  services: string[]
  updatedAt: string
}

/** 事项评论，原型中只追加、不编辑。 */
export interface DemoComment {
  id: string
  author: string
  text: string
  time: string
  bot?: boolean
}

/** 需求或 Bug 的演示记录。 */
export interface DemoItem {
  id: string
  projectId: string
  kind: '需求' | 'Bug'
  title: string
  owner: string
  collaborators: string
  tester: string
  status: string
  pr: string
  description: string
  branch: string
  external: string
  /** Bug 关联的需求编号；需求为空。 */
  requirementId?: string
  comments: DemoComment[]
  activity: string[]
}

/** 原型本地状态；切换团队或重置时只重置演示数据。 */
export interface PrototypeData {
  version: 1
  currentTeamId: string
  currentProjectId: string
  currentRole: TeamRole
  teams: DemoTeam[]
  projects: DemoProject[]
  items: DemoItem[]
}

/** 原型数据提供者向页面暴露的操作。 */
export interface PrototypeActions {
  setCurrentTeam: (teamId: string) => void
  setCurrentProject: (projectId: string) => void
  setCurrentRole: (role: TeamRole) => void
  addItem: (item: DemoItem) => void
  updateItem: (itemId: string, patch: Partial<DemoItem>) => void
  updateProject: (projectId: string, patch: Partial<DemoProject>) => void
  addProject: (project: DemoProject) => void
  updateTeam: (teamId: string, patch: Partial<DemoTeam>) => void
  addComment: (itemId: string, comment: DemoComment) => void
  resetData: () => void
  showToast: (message: string) => void
}
