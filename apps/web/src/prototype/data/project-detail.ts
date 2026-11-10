/** 代码页的只读文件。 */
export interface DemoCodeFile {
  path: string
  content: Record<string, string>
}

/** 原型 PR 摘要，状态与需求业务状态分别维护。 */
export interface DemoPullRequest {
  id: string
  projectId: string
  title: string
  author: string
  status: '待审核' | '草稿' | '已合并'
  sourceBranch: string
  targetBranch: string
  linkedItems: string[]
  diff: string[]
}

/** 流水线运行记录。 */
export interface DemoPipelineRun {
  id: string
  projectId: string
  workflow: string
  branch: string
  status: '运行中' | '成功' | '失败'
  triggeredBy: string
  time: string
  logs: string[]
}

/** 服务构建产物与环境运行版本。 */
export interface DemoServiceDelivery {
  projectId: string
  service: string
  artifact: string
  testVersion: string
  productionVersion: string
  artifactTime: string
  health: '健康' | '待核对'
}

/** 项目环境变量；原型不保存真实密钥值。 */
export interface DemoEnvironmentVariable {
  id: string
  projectId: string
  environment: '开发' | '测试' | '生产'
  name: string
  type: '普通变量' | '密钥'
  value: string
  version: number
  auth: '运行时注入' | '允许 Bot 读取'
  bots: string[]
  updatedAt: string
}

/** 原型代码页的文件与分支内容。 */
export const codeFiles: DemoCodeFile[] = [
  {
    path: 'README.md',
    content: {
      main: `# 研发协作平台

以 Git 仓库为核心的项目协作与交付平台。

## 本地开发

pnpm install
pnpm dev

## 目录

apps/web    Web 前端
apps/server 后端 API
docs/prd    产品需求

当前分支：main

此内容是原型示例，不是从远端读取的真实代码。`,
      'feat/error-handling': `# 研发协作平台

## 当前分支：feat/error-handling

本次变更统一接口错误响应结构，补充错误码与请求标识。

- 失败响应保留 requestId
- 前端按业务错误码展示提示
- 原型中的代码内容仅用于展示交互`,
    },
  },
  {
    path: 'src/api.ts',
    content: {
      main: `// 示例：当前主分支的响应定义
export interface ApiResponse {
  success: boolean
  message: string
  data?: unknown
}
`,
      'feat/error-handling': `// 示例：统一错误响应的开发分支
export interface ApiError {
  success: false
  code: string
  message: string
  requestId: string
}

export interface ApiResponse<T> {
  success: true
  code: 'OK'
  message: string
  requestId: string
  data: T
}
`,
    },
  },
  {
    path: 'docs/prd/mvp.md',
    content: {
      main: `# MVP 需求（演示摘要）

- 项目关联已有 GitHub / Gitea 仓库
- 默认进入协作，群组和任务共享项目上下文
- 业务提测与构建流水线独立
- 构建产物不代表环境运行版本

完整规范以项目 docs/prd/mvp.md 为准。`,
      'feat/error-handling': `# MVP 需求（演示摘要）

- 接口统一返回成功信封与业务错误码
- 认证库协议端点保留库语义
- 提测不触发构建或部署

完整规范以项目 docs/prd/mvp.md 为准。`,
    },
  },
  {
    path: 'package.json',
    content: {
      main: `{
  "name": "dev-ops-demo",
  "private": true,
  "description": "仅用于界面原型的示例文件"
}`,
      'feat/error-handling': `{
  "name": "dev-ops-demo",
  "private": true,
  "description": "仅用于界面原型的示例文件",
  "scripts": {
    "dev": "vite",
    "check": "tsc --noEmit"
  }
}`,
    },
  },
]

/** 原型中的 PR 摘要。 */
export const pullRequests: DemoPullRequest[] = [
  {
    id: '42',
    projectId: 'dev-ops',
    title: '统一错误响应结构',
    author: '林然',
    status: '待审核',
    sourceBranch: 'feat/error-handling',
    targetBranch: 'main',
    linkedItems: ['PRD-024'],
    diff: ["- message: 'Internal error'", "+ code: 'INTERNAL_ERROR'", "+ message: '请求失败，请稍后重试'"],
  },
  {
    id: '46',
    projectId: 'dev-ops',
    title: '优化需求筛选与搜索',
    author: '陈悦',
    status: '草稿',
    sourceBranch: 'feat/requirement-filter',
    targetBranch: 'main',
    linkedItems: ['PRD-028'],
    diff: ['+ filters: status, owner, query', '+ 保持筛选条件到 URL'],
  },
  {
    id: '38',
    projectId: 'dev-ops',
    title: '完善项目成员管理',
    author: '林然',
    status: '已合并',
    sourceBranch: 'feat/member-management',
    targetBranch: 'main',
    linkedItems: ['PRD-021'],
    diff: ['+ 成员角色调整', '+ 最后一位管理员保护'],
  },
  {
    id: '41',
    projectId: 'dev-ops',
    title: '客户反馈附件修复',
    author: '周宁',
    status: '已合并',
    sourceBranch: 'fix/feedback-attachment',
    targetBranch: 'main',
    linkedItems: ['BUG-015'],
    diff: ['- 丢失附件引用', '+ 保留原文件关联'],
  },
  {
    id: '12',
    projectId: 'mobile-app',
    title: '移动端登录体验调整',
    author: '周宁',
    status: '待审核',
    sourceBranch: 'feat/mobile-login',
    targetBranch: 'main',
    linkedItems: ['PRD-008'],
    diff: ['+ 登录状态恢复', '+ 失败重试入口'],
  },
]

/** 原型中的流水线运行记录。 */
export const pipelineRuns: DemoPipelineRun[] = [
  {
    id: 'run-1201',
    projectId: 'dev-ops',
    workflow: 'web-build',
    branch: 'main',
    status: '成功',
    triggeredBy: '研发自配流水线',
    time: '今天 09:42',
    logs: ['checkout a7c92e1', 'install dependencies', 'build web', 'upload artifact: web-0.9.2'],
  },
  {
    id: 'run-1200',
    projectId: 'dev-ops',
    workflow: 'api-test',
    branch: 'feat/error-handling',
    status: '失败',
    triggeredBy: '研发自配流水线',
    time: '昨天 18:10',
    logs: ['checkout b8d304f', 'install dependencies', 'run integration tests', '1 test failed: error envelope'],
  },
  {
    id: 'run-1202',
    projectId: 'dev-ops',
    workflow: 'web-build',
    branch: 'feat/error-handling',
    status: '运行中',
    triggeredBy: '研发自配流水线',
    time: '刚刚',
    logs: ['checkout b8d304f', 'install dependencies', 'build web', 'waiting for runner…'],
  },
]

/** 原型中的服务交付信息。 */
export const serviceDeliveries: DemoServiceDelivery[] = [
  {
    projectId: 'dev-ops',
    service: 'Web',
    artifact: 'v0.9.2-build.18',
    testVersion: 'v0.9.2-build.17',
    productionVersion: 'v0.9.1',
    artifactTime: '今天 09:45',
    health: '健康',
  },
  {
    projectId: 'dev-ops',
    service: 'API',
    artifact: 'v0.9.2-build.18',
    testVersion: 'v0.9.2-build.16',
    productionVersion: 'v0.9.0',
    artifactTime: '今天 09:45',
    health: '健康',
  },
  {
    projectId: 'mobile-app',
    service: 'iOS',
    artifact: 'v2.4.0-build.7',
    testVersion: 'v2.4.0-build.6',
    productionVersion: 'v2.3.2',
    artifactTime: '昨天 16:20',
    health: '待核对',
  },
  {
    projectId: 'mobile-app',
    service: 'Android',
    artifact: 'v2.4.0-build.7',
    testVersion: 'v2.4.0-build.5',
    productionVersion: 'v2.3.2',
    artifactTime: '昨天 16:20',
    health: '健康',
  },
]

/** 原型中的环境变量。 */
export const environmentVariables: DemoEnvironmentVariable[] = [
  {
    id: 'env-1',
    projectId: 'dev-ops',
    environment: '开发',
    name: 'API_BASE_URL',
    type: '普通变量',
    value: 'http://127.0.0.1:3001',
    version: 3,
    auth: '运行时注入',
    bots: ['项目助手'],
    updatedAt: '今天 10:02',
  },
  {
    id: 'env-2',
    projectId: 'dev-ops',
    environment: '测试',
    name: 'GIT_READ_TOKEN',
    type: '密钥',
    value: '',
    version: 2,
    auth: '运行时注入',
    bots: ['研发助手'],
    updatedAt: '昨天 17:30',
  },
  {
    id: 'env-3',
    projectId: 'dev-ops',
    environment: '测试',
    name: 'FEATURE_FLAGS',
    type: '普通变量',
    value: 'feedback,error-envelope',
    version: 1,
    auth: '允许 Bot 读取',
    bots: ['项目助手'],
    updatedAt: '11月06日',
  },
  {
    id: 'env-4',
    projectId: 'dev-ops',
    environment: '生产',
    name: 'DEPLOY_ENV',
    type: '普通变量',
    value: 'production',
    version: 5,
    auth: '运行时注入',
    bots: [],
    updatedAt: '11月05日',
  },
  {
    id: 'env-5',
    projectId: 'mobile-app',
    environment: '开发',
    name: 'APP_API_URL',
    type: '普通变量',
    value: 'http://127.0.0.1:3001',
    version: 1,
    auth: '运行时注入',
    bots: [],
    updatedAt: '昨天 14:20',
  },
]
