/**
 * 内置流水线交互原型数据模型与演示数据集。
 *
 * 字段设计对齐平台内置流水线契约（.devops/workflows/*.yml、workflow_dispatch、
 * jobs/needs/steps、自托管执行节点、日志分片与受控产物），仅用于 `/prototype` 本地交互演示。
 */

/** 流水线运行状态，与后端状态机保持一致。 */
export type ProtoPipelineRunStatus =
  'queued' | 'assigned' | 'running' | 'cancelling' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted'

/** 单个步骤的执行状态。 */
export type ProtoPipelineStepStatus =
  'pending' | 'running' | 'succeeded' | 'failed' | 'skipped' | 'cancelled' | 'interrupted'

/** 步骤类型，与 YAML 子集契约一致。 */
export type ProtoPipelineStepKind = 'builtin_checkout' | 'run' | 'builtin_upload_artifact'

/** 工作流解析错误定位信息。 */
export interface ProtoWorkflowParseError {
  code: string
  message: string
  fieldPath: string
  line: number
  column: number
}

/** 工作流声明的手动触发输入项。 */
export interface ProtoWorkflowInputDef {
  name: string
  type: 'choice' | 'boolean' | 'string' | 'number'
  description: string
  required: boolean
  defaultValue: string | boolean | number
  options?: string[]
}

/** 工作流静态解析出的步骤定义。 */
export interface ProtoWorkflowStepDef {
  index: number
  name: string
  kind: ProtoPipelineStepKind
  commandPreview?: string
  artifactName?: string
  timeoutMinutes?: number
}

/** 工作流静态解析出的 Job 定义。 */
export interface ProtoWorkflowJobDef {
  id: string
  name: string
  runsOn: string
  needs: string[]
  timeoutMinutes: number
  steps: ProtoWorkflowStepDef[]
}

/** 仓库内工作流摘要与详情。 */
export interface ProtoPipelineWorkflow {
  id: string
  projectId: string
  name: string
  path: string
  description: string
  ref: string
  commitSha: string
  valid: boolean
  parseErrors: ProtoWorkflowParseError[]
  trigger: 'workflow_dispatch'
  timeoutMinutes: number
  runsOn: string[]
  inputs: ProtoWorkflowInputDef[]
  jobs: ProtoWorkflowJobDef[]
  yamlContent: string
  /** 最近最多 5 次运行结果，从旧到新排列，用于健康趋势条展示。 */
  recentOutcomes: ProtoPipelineRunStatus[]
}

/** 自托管执行节点摘要。 */
export interface ProtoPipelineNode {
  id: string
  name: string
  status: 'online' | 'busy' | 'offline'
  os: string
  arch: string
  capabilities: string[]
  runningJobs: number
  concurrencyLimit: number
}

/** 单行终端日志。 */
export interface ProtoPipelineLogLine {
  time: string
  text: string
  level?: 'info' | 'cmd' | 'success' | 'warn' | 'error' | 'masked'
}

/** 运行中单个步骤的执行事实与日志。 */
export interface ProtoPipelineStepRun {
  index: number
  jobId: string
  jobName: string
  name: string
  kind: ProtoPipelineStepKind
  status: ProtoPipelineStepStatus
  startedAt: string | null
  finishedAt: string | null
  durationSeconds: number | null
  exitCode: number | null
  errorCode?: string
  errorMessage?: string
  commandPreview?: string
  logs: ProtoPipelineLogLine[]
}

/** 运行中单个 Job 的聚合状态。 */
export interface ProtoPipelineJobRun {
  id: string
  name: string
  runsOn: string
  needs: string[]
  status: ProtoPipelineStepStatus
  nodeName: string | null
  durationSeconds: number | null
  steps: ProtoPipelineStepRun[]
}

/** 平台托管构建产物。 */
export interface ProtoPipelineArtifact {
  id: string
  name: string
  stepIndex: number
  stepName: string
  sizeLabel: string
  sha256: string
  createdAt: string
  retentionDays: number
}

/** 一次完整的流水线运行记录。 */
export interface ProtoPipelineRun {
  id: string
  runNumber: number
  shortId: string
  projectId: string
  workflowPath: string
  workflowName: string
  ref: string
  commitSha: string
  commitMessage: string
  status: ProtoPipelineRunStatus
  triggerSource: 'manual'
  initiator: string
  initiatorChannel: 'Web 页面' | 'API' | 'CLI'
  nodeName: string | null
  nodeTag: string
  createdAt: string
  relativeTime: string
  startedAt: string | null
  finishedAt: string | null
  durationSeconds: number | null
  inputs: Record<string, string | number | boolean>
  errorCode?: string
  errorMessage?: string
  jobs: ProtoPipelineJobRun[]
  artifacts: ProtoPipelineArtifact[]
  yamlSnapshot: string
}

/** 可供工作流解析切换的演示分支与对应提交。 */
export const protoPipelineRefs: Record<string, Array<{ ref: string; commitSha: string; commitMessage: string }>> = {
  'dev-ops': [
    {
      ref: 'main',
      commitSha: '83fa6c4669fe9a27749292cdcc65b86502179de2',
      commitMessage: 'feat(pipeline): 优化工作流阶段展示与运行过程可视化',
    },
    {
      ref: 'feat/error-handling',
      commitSha: 'b8d304f18c7d4109e6ab22f93877b9c1a042e51a',
      commitMessage: 'refactor(api): 统一错误响应信封与业务错误码',
    },
    {
      ref: 'release/v0.4',
      commitSha: 'd83af6880a2c5f9b4d31e7741a2b69cc40f12981',
      commitMessage: 'build(docker): 升级 Node 24.15 生产基础镜像',
    },
  ],
  'mobile-app': [
    {
      ref: 'main',
      commitSha: '4a92c1e89b103f7a62d88e10421b9d73ac510f20',
      commitMessage: 'feat(mobile): 适配移动端登录态恢复与离线提示',
    },
  ],
}

/** 原型自托管执行节点列表。 */
export const protoPipelineNodes: ProtoPipelineNode[] = [
  {
    id: 'node-macmini',
    name: 'Mac mini 原生发布',
    status: 'busy',
    os: 'macOS',
    arch: 'arm64',
    capabilities: ['macmini-deploy', 'macos-xcode'],
    runningJobs: 1,
    concurrencyLimit: 2,
  },
  {
    id: 'node-linux-01',
    name: 'linux-docker-01',
    status: 'online',
    os: 'Linux',
    arch: 'x86_64',
    capabilities: ['linux-docker', 'node-24'],
    runningJobs: 0,
    concurrencyLimit: 4,
  },
  {
    id: 'node-docker-buildx',
    name: 'docker-buildx-01',
    status: 'offline',
    os: 'Linux',
    arch: 'arm64',
    capabilities: ['docker-buildx'],
    runningJobs: 0,
    concurrencyLimit: 2,
  },
]

const DEPLOY_MACMINI_YAML = `name: deploy-macmini

on:
  workflow_dispatch:
    inputs:
      target_env:
        description: 目标发布环境
        type: choice
        options: [production, staging]
        default: production
      skip_migrate:
        description: 跳过数据库迁移（仅纯前端紧急回滚使用）
        type: boolean
        default: false

jobs:
  deploy:
    name: Mac mini 原生发布
    runs-on: macmini-deploy
    timeout-minutes: 35
    steps:
      - name: 检出本次发布的提交
        uses: builtin:checkout
        with:
          fetch-depth: "1"
      - name: 构建、迁移并切换生产版本
        run: bash .devops/scripts/release-main.sh '\${{ github.sha }}'
        env:
          TARGET_ENV: \${{ inputs.target_env }}
          SKIP_MIGRATE: \${{ inputs.skip_migrate }}
        timeout-minutes: 30
      - name: 服务健康检查与发布报告归档
        uses: builtin:upload-artifact
        with:
          name: deploy-report
          path: .artifacts/deploy-report.log`

const WEB_CI_YAML = `name: web-ci-build

on:
  workflow_dispatch:
    inputs:
      target:
        description: 构建范围（all / web / server）
        type: choice
        options: [all, web, server]
        default: all

env:
  NODE_ENV: production

jobs:
  quality:
    name: 静态检查与单元测试
    runs-on: linux-docker
    timeout-minutes: 15
    steps:
      - name: 检出代码
        uses: builtin:checkout
      - name: 安装依赖（pnpm）
        run: pnpm install --frozen-lockfile
      - name: 类型检查与单元测试
        run: pnpm --dir apps/web check && pnpm ui:check
  package:
    name: 生产构建与产物归档
    runs-on: linux-docker
    needs: [quality]
    timeout-minutes: 15
    steps:
      - name: 检出代码
        uses: builtin:checkout
      - name: 打包生产静态资源
        run: pnpm --dir apps/web build
      - name: 上传 web-dist 产物
        uses: builtin:upload-artifact
        with:
          name: web-dist
          path: apps/web/dist`

const DOCKER_RELEASE_YAML = `name: docker-image-release

on:
  workflow_dispatch:
    inputs:
      service:
        description: 需要构建镜像的服务模块
        type: choice
        options: [server, web, pipeline-agent]
        default: server
      tag:
        description: 镜像版本标签（如 v0.4.2）
        type: string
        required: true
        default: v0.4.2
      push_latest:
        description: 同步更新 latest 标签
        type: boolean
        default: false

jobs:
  image:
    name: 构建并推送容器镜像
    runs-on: docker-buildx
    timeout-minutes: 25
    steps:
      - name: 检出代码
        uses: builtin:checkout
      - name: BuildKit 多架构构建
        run: docker buildx build --target \${{ inputs.service }} -t registry.internal/devops-\${{ inputs.service }}:\${{ inputs.tag }} .
      - name: 推送至私有镜像仓库
        run: docker push registry.internal/devops-\${{ inputs.service }}:\${{ inputs.tag }}
        env:
          REGISTRY_TOKEN: \${{ secrets.REGISTRY_PUSH_TOKEN }}`

const BROKEN_AUDIT_YAML = `name: nightly-audit

on:
  schedule:
    - cron: "0 2 * * *"

jobs:
  audit:
    name: 依赖安全巡检
    runs-on: linux-docker
    steps:
      - name: 检出代码
        uses: builtin:checkout
      - name: 运行安全扫描
        if: \${{ secrets.AUDIT_TOKEN != '' }}
        run: pnpm audit --prod`

const MOBILE_APK_YAML = `name: flutter-android-apk

on:
  workflow_dispatch:
    inputs:
      flavor:
        description: 构建渠道
        type: choice
        options: [staging, prod]
        default: staging

jobs:
  android:
    name: Android 安装包构建
    runs-on: linux-docker
    timeout-minutes: 30
    steps:
      - name: 检出代码
        uses: builtin:checkout
      - name: Flutter 依赖与测试
        run: flutter pub get && flutter test
      - name: 构建 Release APK
        run: flutter build apk --release --flavor \${{ inputs.flavor }}
      - name: 上传 APK 产物
        uses: builtin:upload-artifact
        with:
          name: app-release-apk
          path: build/app/outputs/flutter-apk/app-release.apk`

/** 原型仓库内工作流定义集合。 */
export const protoPipelineWorkflows: ProtoPipelineWorkflow[] = [
  {
    id: 'wf-deploy-macmini',
    projectId: 'dev-ops',
    name: 'deploy-macmini',
    path: '.devops/workflows/deploy-macmini.yml',
    description: '检出指定提交并在 Mac mini 生产节点执行构建、数据库迁移、重启与健康检查。',
    ref: 'main',
    commitSha: '83fa6c4669fe9a27749292cdcc65b86502179de2',
    valid: true,
    parseErrors: [],
    trigger: 'workflow_dispatch',
    timeoutMinutes: 35,
    runsOn: ['macmini-deploy'],
    inputs: [
      {
        name: 'target_env',
        type: 'choice',
        description: '目标发布环境',
        required: true,
        defaultValue: 'production',
        options: ['production', 'staging'],
      },
      {
        name: 'skip_migrate',
        type: 'boolean',
        description: '跳过数据库迁移（仅纯前端紧急回滚使用）',
        required: false,
        defaultValue: false,
      },
    ],
    jobs: [
      {
        id: 'deploy',
        name: 'Mac mini 原生发布',
        runsOn: 'macmini-deploy',
        needs: [],
        timeoutMinutes: 35,
        steps: [
          {
            index: 0,
            name: '检出本次发布的提交',
            kind: 'builtin_checkout',
            commandPreview: 'builtin:checkout (depth=1)',
          },
          {
            index: 1,
            name: '构建、迁移并切换生产版本',
            kind: 'run',
            commandPreview: "bash .devops/scripts/release-main.sh '${{ github.sha }}'",
            timeoutMinutes: 30,
          },
          {
            index: 2,
            name: '服务健康检查与发布报告归档',
            kind: 'builtin_upload_artifact',
            artifactName: 'deploy-report',
          },
        ],
      },
    ],
    yamlContent: DEPLOY_MACMINI_YAML,
    recentOutcomes: ['succeeded', 'succeeded', 'failed', 'succeeded', 'running'],
  },
  {
    id: 'wf-web-ci',
    projectId: 'dev-ops',
    name: 'web-ci-build',
    path: '.devops/workflows/web-ci-build.yml',
    description: '多阶段 CI：先执行类型检查、UI 规范与单元测试，通过后打包静态资源并归档产物。',
    ref: 'main',
    commitSha: '83fa6c4669fe9a27749292cdcc65b86502179de2',
    valid: true,
    parseErrors: [],
    trigger: 'workflow_dispatch',
    timeoutMinutes: 30,
    runsOn: ['linux-docker'],
    inputs: [
      {
        name: 'target',
        type: 'choice',
        description: '构建范围（all / web / server）',
        required: false,
        defaultValue: 'all',
        options: ['all', 'web', 'server'],
      },
    ],
    jobs: [
      {
        id: 'quality',
        name: '静态检查与单元测试',
        runsOn: 'linux-docker',
        needs: [],
        timeoutMinutes: 15,
        steps: [
          { index: 0, name: '检出代码', kind: 'builtin_checkout', commandPreview: 'builtin:checkout' },
          { index: 1, name: '安装依赖（pnpm）', kind: 'run', commandPreview: 'pnpm install --frozen-lockfile' },
          {
            index: 2,
            name: '类型检查与单元测试',
            kind: 'run',
            commandPreview: 'pnpm --dir apps/web check && pnpm ui:check',
          },
        ],
      },
      {
        id: 'package',
        name: '生产构建与产物归档',
        runsOn: 'linux-docker',
        needs: ['quality'],
        timeoutMinutes: 15,
        steps: [
          { index: 3, name: '检出代码', kind: 'builtin_checkout', commandPreview: 'builtin:checkout' },
          { index: 4, name: '打包生产静态资源', kind: 'run', commandPreview: 'pnpm --dir apps/web build' },
          { index: 5, name: '上传 web-dist 产物', kind: 'builtin_upload_artifact', artifactName: 'web-dist' },
        ],
      },
    ],
    yamlContent: WEB_CI_YAML,
    recentOutcomes: ['succeeded', 'succeeded', 'succeeded', 'succeeded', 'failed'],
  },
  {
    id: 'wf-docker-release',
    projectId: 'dev-ops',
    name: 'docker-image-release',
    path: '.devops/workflows/docker-image-release.yml',
    description: '使用 BuildKit 构建指定服务的容器镜像并推送至团队私有镜像仓库。',
    ref: 'main',
    commitSha: '83fa6c4669fe9a27749292cdcc65b86502179de2',
    valid: true,
    parseErrors: [],
    trigger: 'workflow_dispatch',
    timeoutMinutes: 25,
    runsOn: ['docker-buildx'],
    inputs: [
      {
        name: 'service',
        type: 'choice',
        description: '需要构建镜像的服务模块',
        required: true,
        defaultValue: 'server',
        options: ['server', 'web', 'pipeline-agent'],
      },
      {
        name: 'tag',
        type: 'string',
        description: '镜像版本标签（如 v0.4.2）',
        required: true,
        defaultValue: 'v0.4.2',
      },
      {
        name: 'push_latest',
        type: 'boolean',
        description: '同步更新 latest 标签',
        required: false,
        defaultValue: false,
      },
    ],
    jobs: [
      {
        id: 'image',
        name: '构建并推送容器镜像',
        runsOn: 'docker-buildx',
        needs: [],
        timeoutMinutes: 25,
        steps: [
          { index: 0, name: '检出代码', kind: 'builtin_checkout', commandPreview: 'builtin:checkout' },
          {
            index: 1,
            name: 'BuildKit 多架构构建',
            kind: 'run',
            commandPreview: 'docker buildx build --target ${{ inputs.service }} ...',
          },
          {
            index: 2,
            name: '推送至私有镜像仓库',
            kind: 'run',
            commandPreview: 'docker push registry.internal/devops-${{ inputs.service }}:${{ inputs.tag }}',
          },
        ],
      },
    ],
    yamlContent: DOCKER_RELEASE_YAML,
    recentOutcomes: ['succeeded', 'cancelled', 'interrupted', 'queued'],
  },
  {
    id: 'wf-nightly-audit',
    projectId: 'dev-ops',
    name: 'nightly-audit',
    path: '.devops/workflows/nightly-audit.yml',
    description: '定时依赖安全巡检（当前存在两处 P1 语法与安全校验错误，修复提交后才可触发）。',
    ref: 'main',
    commitSha: '83fa6c4669fe9a27749292cdcc65b86502179de2',
    valid: false,
    parseErrors: [
      {
        code: 'WORKFLOW_UNSUPPORTED',
        message: 'P1 仅支持 on.workflow_dispatch 手动触发，暂不支持 schedule 定时事件。',
        fieldPath: 'on.schedule',
        line: 4,
        column: 3,
      },
      {
        code: 'WORKFLOW_SECRET_IN_UNSAFE_POSITION',
        message: 'secrets.AUDIT_TOKEN 仅允许用于 env 或 with，禁止直接写入 if 条件表达式。',
        fieldPath: 'jobs.audit.steps[1].if',
        line: 15,
        column: 9,
      },
    ],
    trigger: 'workflow_dispatch',
    timeoutMinutes: 15,
    runsOn: ['linux-docker'],
    inputs: [],
    jobs: [],
    yamlContent: BROKEN_AUDIT_YAML,
    recentOutcomes: [],
  },
  {
    id: 'wf-mobile-apk',
    projectId: 'mobile-app',
    name: 'flutter-android-apk',
    path: '.devops/workflows/flutter-android-apk.yml',
    description: '构建客户应用 Android Release APK 并归档可下载安装包。',
    ref: 'main',
    commitSha: '4a92c1e89b103f7a62d88e10421b9d73ac510f20',
    valid: true,
    parseErrors: [],
    trigger: 'workflow_dispatch',
    timeoutMinutes: 30,
    runsOn: ['linux-docker'],
    inputs: [
      {
        name: 'flavor',
        type: 'choice',
        description: '构建渠道',
        required: true,
        defaultValue: 'staging',
        options: ['staging', 'prod'],
      },
    ],
    jobs: [
      {
        id: 'android',
        name: 'Android 安装包构建',
        runsOn: 'linux-docker',
        needs: [],
        timeoutMinutes: 30,
        steps: [
          { index: 0, name: '检出代码', kind: 'builtin_checkout' },
          { index: 1, name: 'Flutter 依赖与测试', kind: 'run', commandPreview: 'flutter pub get && flutter test' },
          { index: 2, name: '构建 Release APK', kind: 'run', commandPreview: 'flutter build apk --release' },
          { index: 3, name: '上传 APK 产物', kind: 'builtin_upload_artifact', artifactName: 'app-release-apk' },
        ],
      },
    ],
    yamlContent: MOBILE_APK_YAML,
    recentOutcomes: ['succeeded', 'succeeded', 'succeeded'],
  },
]

/** 原型初始运行历史数据，覆盖运行中、失败、成功、排队中、中断等多种状态。 */
export const initialProtoPipelineRuns: ProtoPipelineRun[] = [
  {
    id: 'run-18',
    runNumber: 18,
    shortId: '7e41c92a',
    projectId: 'dev-ops',
    workflowPath: '.devops/workflows/deploy-macmini.yml',
    workflowName: 'deploy-macmini',
    ref: 'main',
    commitSha: '83fa6c4669fe9a27749292cdcc65b86502179de2',
    commitMessage: 'feat(pipeline): 优化工作流阶段展示与运行过程可视化',
    status: 'running',
    triggerSource: 'manual',
    initiator: '林然',
    initiatorChannel: 'Web 页面',
    nodeName: 'Mac mini 原生发布',
    nodeTag: 'macmini-deploy',
    createdAt: '2026/11/26 19:24',
    relativeTime: '刚刚',
    startedAt: '2026/11/26 19:24:08',
    finishedAt: null,
    durationSeconds: 58,
    inputs: { target_env: 'production', skip_migrate: false },
    jobs: [
      {
        id: 'deploy',
        name: 'Mac mini 原生发布',
        runsOn: 'macmini-deploy',
        needs: [],
        status: 'running',
        nodeName: 'Mac mini 原生发布',
        durationSeconds: 58,
        steps: [
          {
            index: 0,
            jobId: 'deploy',
            jobName: 'Mac mini 原生发布',
            name: '检出本次发布的提交',
            kind: 'builtin_checkout',
            status: 'succeeded',
            startedAt: '2026/11/26 19:24:08',
            finishedAt: '2026/11/26 19:24:20',
            durationSeconds: 12,
            exitCode: 0,
            commandPreview: 'builtin:checkout (depth=1)',
            logs: [
              { time: '19:24:08', text: '准备隔离工作区 /var/lib/devops-agent/work/run-7e41c92a', level: 'info' },
              {
                time: '19:24:09',
                text: '$ git fetch --depth=1 origin 83fa6c4669fe9a27749292cdcc65b86502179de2',
                level: 'cmd',
              },
              { time: '19:24:17', text: '检出提交 83fa6c4669fe9a27749292cdcc65b86502179de2', level: 'info' },
              { time: '19:24:19', text: '已同步 submodule packages/devops-bot @ a92f11c', level: 'info' },
              { time: '19:24:20', text: '✓ 已检出提交 83fa6c46（耗时 12 秒）', level: 'success' },
            ],
          },
          {
            index: 1,
            jobId: 'deploy',
            jobName: 'Mac mini 原生发布',
            name: '构建、迁移并切换生产版本',
            kind: 'run',
            status: 'running',
            startedAt: '2026/11/26 19:24:20',
            finishedAt: null,
            durationSeconds: 46,
            exitCode: null,
            commandPreview: "bash .devops/scripts/release-main.sh '83fa6c46'",
            logs: [
              {
                time: '19:24:20',
                text: "$ bash .devops/scripts/release-main.sh '83fa6c4669fe9a27749292cdcc65b86502179de2'",
                level: 'cmd',
              },
              { time: '19:24:21', text: '注入运行时凭据：DATABASE_URL=***  SESSION_SECRET=***', level: 'masked' },
              { time: '19:24:24', text: '[1/4] pnpm install --frozen-lockfile --offline', level: 'info' },
              { time: '19:24:33', text: 'Done in 8.7s using pnpm v11.12.0', level: 'info' },
              { time: '19:24:34', text: '[2/4] pnpm api:generate && pnpm --filter @dev-ops/web build', level: 'cmd' },
              {
                time: '19:24:51',
                text: 'vite v8.3.6 building for production... 2,418 modules transformed.',
                level: 'info',
              },
              { time: '19:24:58', text: 'dist/assets/index-D9a1f82c.js   412.6 kB │ gzip: 129.4 kB', level: 'info' },
              { time: '19:25:01', text: '[3/4] 执行 PostgreSQL 迁移检查 (drizzle migrate)...', level: 'info' },
              { time: '19:25:06', text: '正在校验数据库版本与迁移锁，等待切换生产进程...', level: 'warn' },
            ],
          },
          {
            index: 2,
            jobId: 'deploy',
            jobName: 'Mac mini 原生发布',
            name: '服务健康检查与发布报告归档',
            kind: 'builtin_upload_artifact',
            status: 'pending',
            startedAt: null,
            finishedAt: null,
            durationSeconds: null,
            exitCode: null,
            commandPreview: 'builtin:upload-artifact (deploy-report)',
            logs: [],
          },
        ],
      },
    ],
    artifacts: [],
    yamlSnapshot: DEPLOY_MACMINI_YAML,
  },
  {
    id: 'run-17',
    runNumber: 17,
    shortId: 'c38e104d',
    projectId: 'dev-ops',
    workflowPath: '.devops/workflows/web-ci-build.yml',
    workflowName: 'web-ci-build',
    ref: 'feat/error-handling',
    commitSha: 'b8d304f18c7d4109e6ab22f93877b9c1a042e51a',
    commitMessage: 'refactor(api): 统一错误响应信封与业务错误码',
    status: 'failed',
    triggerSource: 'manual',
    initiator: '陈悦',
    initiatorChannel: 'CLI',
    nodeName: 'linux-docker-01',
    nodeTag: 'linux-docker',
    createdAt: '2026/11/26 19:12',
    relativeTime: '13 分钟前',
    startedAt: '2026/11/26 19:12:03',
    finishedAt: '2026/11/26 19:12:51',
    durationSeconds: 48,
    inputs: { target: 'web' },
    errorCode: 'STEP_NON_ZERO_EXIT',
    errorMessage: '第 3 步「类型检查与单元测试」退出码 1：AssertionError (error-envelope.test.ts:42)',
    jobs: [
      {
        id: 'quality',
        name: '静态检查与单元测试',
        runsOn: 'linux-docker',
        needs: [],
        status: 'failed',
        nodeName: 'linux-docker-01',
        durationSeconds: 48,
        steps: [
          {
            index: 0,
            jobId: 'quality',
            jobName: '静态检查与单元测试',
            name: '检出代码',
            kind: 'builtin_checkout',
            status: 'succeeded',
            startedAt: '2026/11/26 19:12:03',
            finishedAt: '2026/11/26 19:12:09',
            durationSeconds: 6,
            exitCode: 0,
            commandPreview: 'builtin:checkout',
            logs: [
              {
                time: '19:12:03',
                text: '$ git fetch --depth=1 origin b8d304f18c7d4109e6ab22f93877b9c1a042e51a',
                level: 'cmd',
              },
              { time: '19:12:09', text: '✓ 已检出分支 feat/error-handling @ b8d304f1', level: 'success' },
            ],
          },
          {
            index: 1,
            jobId: 'quality',
            jobName: '静态检查与单元测试',
            name: '安装依赖（pnpm）',
            kind: 'run',
            status: 'succeeded',
            startedAt: '2026/11/26 19:12:09',
            finishedAt: '2026/11/26 19:12:33',
            durationSeconds: 24,
            exitCode: 0,
            commandPreview: 'pnpm install --frozen-lockfile',
            logs: [
              { time: '19:12:09', text: '$ pnpm install --frozen-lockfile', level: 'cmd' },
              { time: '19:12:14', text: 'Scope: all 6 workspace projects', level: 'info' },
              { time: '19:12:33', text: '✓ Packages: +842  Done in 23.8s', level: 'success' },
            ],
          },
          {
            index: 2,
            jobId: 'quality',
            jobName: '静态检查与单元测试',
            name: '类型检查与单元测试',
            kind: 'run',
            status: 'failed',
            startedAt: '2026/11/26 19:12:33',
            finishedAt: '2026/11/26 19:12:51',
            durationSeconds: 18,
            exitCode: 1,
            errorCode: 'STEP_NON_ZERO_EXIT',
            errorMessage: '进程返回退出码 1（1 个测试用例失败）',
            commandPreview: 'pnpm --dir apps/web check && pnpm ui:check',
            logs: [
              { time: '19:12:33', text: '$ pnpm --dir apps/web check && pnpm ui:check', level: 'cmd' },
              { time: '19:12:36', text: 'oxlint: Found 0 warnings and 0 errors.', level: 'info' },
              { time: '19:12:41', text: 'tsc -b --noEmit: passed in 4.6s', level: 'info' },
              { time: '19:12:44', text: 'RUN  v5.1.0 /workspace/apps/web', level: 'info' },
              {
                time: '19:12:48',
                text: '✓ src/pages/project/pipelines-page.test.tsx (14 tests) 312ms',
                level: 'success',
              },
              {
                time: '19:12:49',
                text: '✕ src/shared/api/error-envelope.test.ts > 保留业务错误码与 requestId',
                level: 'error',
              },
              {
                time: '19:12:49',
                text: '  AssertionError: expected "INTERNAL_ERROR" to equal "PIPELINE_NODE_OFFLINE" (line 42)',
                level: 'error',
              },
              { time: '19:12:51', text: 'Test Files  1 failed | 27 passed (28)  —  exit code 1', level: 'error' },
            ],
          },
        ],
      },
      {
        id: 'package',
        name: '生产构建与产物归档',
        runsOn: 'linux-docker',
        needs: ['quality'],
        status: 'skipped',
        nodeName: null,
        durationSeconds: null,
        steps: [
          {
            index: 3,
            jobId: 'package',
            jobName: '生产构建与产物归档',
            name: '检出代码',
            kind: 'builtin_checkout',
            status: 'skipped',
            startedAt: null,
            finishedAt: null,
            durationSeconds: null,
            exitCode: null,
            logs: [],
          },
          {
            index: 4,
            jobId: 'package',
            jobName: '生产构建与产物归档',
            name: '打包生产静态资源',
            kind: 'run',
            status: 'skipped',
            startedAt: null,
            finishedAt: null,
            durationSeconds: null,
            exitCode: null,
            logs: [],
          },
          {
            index: 5,
            jobId: 'package',
            jobName: '生产构建与产物归档',
            name: '上传 web-dist 产物',
            kind: 'builtin_upload_artifact',
            status: 'skipped',
            startedAt: null,
            finishedAt: null,
            durationSeconds: null,
            exitCode: null,
            logs: [],
          },
        ],
      },
    ],
    artifacts: [],
    yamlSnapshot: WEB_CI_YAML,
  },
  {
    id: 'run-16',
    runNumber: 16,
    shortId: '294575be',
    projectId: 'dev-ops',
    workflowPath: '.devops/workflows/deploy-macmini.yml',
    workflowName: 'deploy-macmini',
    ref: 'main',
    commitSha: '83fa6c4669fe9a27749292cdcc65b86502179de2',
    commitMessage: 'fix(tooling): hooks 只识别命令段开头的 git 子命令',
    status: 'succeeded',
    triggerSource: 'manual',
    initiator: 'linghe28322',
    initiatorChannel: 'API',
    nodeName: 'Mac mini 原生发布',
    nodeTag: 'macmini-deploy',
    createdAt: '2026/11/26 19:17',
    relativeTime: '7 分钟前',
    startedAt: '2026/11/26 19:17:04',
    finishedAt: '2026/11/26 19:19:01',
    durationSeconds: 117,
    inputs: { target_env: 'production', skip_migrate: false },
    jobs: [
      {
        id: 'deploy',
        name: 'Mac mini 原生发布',
        runsOn: 'macmini-deploy',
        needs: [],
        status: 'succeeded',
        nodeName: 'Mac mini 原生发布',
        durationSeconds: 117,
        steps: [
          {
            index: 0,
            jobId: 'deploy',
            jobName: 'Mac mini 原生发布',
            name: '检出本次发布的提交',
            kind: 'builtin_checkout',
            status: 'succeeded',
            startedAt: '2026/11/26 19:17:04',
            finishedAt: '2026/11/26 19:17:16',
            durationSeconds: 12,
            exitCode: 0,
            commandPreview: 'builtin:checkout (depth=1)',
            logs: [
              { time: '19:17:04', text: '检出提交 83fa6c4669fe9a27749292cdcc65b86502179de2', level: 'info' },
              { time: '19:17:16', text: '✓ 已检出提交 83fa6c46', level: 'success' },
            ],
          },
          {
            index: 1,
            jobId: 'deploy',
            jobName: 'Mac mini 原生发布',
            name: '构建、迁移并切换生产版本',
            kind: 'run',
            status: 'succeeded',
            startedAt: '2026/11/26 19:17:16',
            finishedAt: '2026/11/26 19:18:56',
            durationSeconds: 100,
            exitCode: 0,
            commandPreview: "bash .devops/scripts/release-main.sh '83fa6c46'",
            logs: [
              {
                time: '19:17:16',
                text: "$ bash .devops/scripts/release-main.sh '83fa6c4669fe9a27749292cdcc65b86502179de2'",
                level: 'cmd',
              },
              { time: '19:17:18', text: '注入密钥：DATABASE_URL=***  JWT_SECRET=***', level: 'masked' },
              { time: '19:17:44', text: 'pnpm build 完成（apps/server、apps/web、apps/cli）', level: 'info' },
              { time: '19:18:22', text: 'drizzle migrate: 0 pending migrations', level: 'info' },
              { time: '19:18:48', text: '切换生产软链 -> /srv/devops/releases/83fa6c46', level: 'info' },
              { time: '19:18:56', text: '✓ 服务重启完成，/api/v1/ready 返回 OK', level: 'success' },
            ],
          },
          {
            index: 2,
            jobId: 'deploy',
            jobName: 'Mac mini 原生发布',
            name: '服务健康检查与发布报告归档',
            kind: 'builtin_upload_artifact',
            status: 'succeeded',
            startedAt: '2026/11/26 19:18:56',
            finishedAt: '2026/11/26 19:19:01',
            durationSeconds: 5,
            exitCode: 0,
            commandPreview: 'builtin:upload-artifact (deploy-report)',
            logs: [
              { time: '19:18:57', text: '打包产物 .artifacts/deploy-report.log (18.4 KB)', level: 'info' },
              { time: '19:19:01', text: '✓ 已上传产物 deploy-report (sha256: 9f41e2b8c30a…)', level: 'success' },
            ],
          },
        ],
      },
    ],
    artifacts: [
      {
        id: 'art-16-1',
        name: 'deploy-report-83fa6c46.log',
        stepIndex: 2,
        stepName: '服务健康检查与发布报告归档',
        sizeLabel: '18.4 KB',
        sha256: '9f41e2b8c30a71fd55091b3e824c60ab87f12e30',
        createdAt: '2026/11/26 19:19',
        retentionDays: 30,
      },
    ],
    yamlSnapshot: DEPLOY_MACMINI_YAML,
  },
  {
    id: 'run-15',
    runNumber: 15,
    shortId: 'a81d02ef',
    projectId: 'dev-ops',
    workflowPath: '.devops/workflows/web-ci-build.yml',
    workflowName: 'web-ci-build',
    ref: 'main',
    commitSha: 'fe834ff29910e43b77d211c8a91b22014c8f10ab',
    commitMessage: 'feat(capabilities): 重构 Skills 与提示模板页面为 Hub 体验',
    status: 'succeeded',
    triggerSource: 'manual',
    initiator: '林然',
    initiatorChannel: 'Web 页面',
    nodeName: 'linux-docker-01',
    nodeTag: 'linux-docker',
    createdAt: '2026/11/26 17:10',
    relativeTime: '2 小时前',
    startedAt: '2026/11/26 17:10:05',
    finishedAt: '2026/11/26 17:12:19',
    durationSeconds: 134,
    inputs: { target: 'all' },
    jobs: [
      {
        id: 'quality',
        name: '静态检查与单元测试',
        runsOn: 'linux-docker',
        needs: [],
        status: 'succeeded',
        nodeName: 'linux-docker-01',
        durationSeconds: 76,
        steps: [
          {
            index: 0,
            jobId: 'quality',
            jobName: '静态检查与单元测试',
            name: '检出代码',
            kind: 'builtin_checkout',
            status: 'succeeded',
            startedAt: '2026/11/26 17:10:05',
            finishedAt: '2026/11/26 17:10:12',
            durationSeconds: 7,
            exitCode: 0,
            logs: [{ time: '17:10:12', text: '✓ 已检出提交 fe834ff2', level: 'success' }],
          },
          {
            index: 1,
            jobId: 'quality',
            jobName: '静态检查与单元测试',
            name: '安装依赖（pnpm）',
            kind: 'run',
            status: 'succeeded',
            startedAt: '2026/11/26 17:10:12',
            finishedAt: '2026/11/26 17:10:39',
            durationSeconds: 27,
            exitCode: 0,
            logs: [{ time: '17:10:39', text: '✓ pnpm install 完成（命中 store 缓存）', level: 'success' }],
          },
          {
            index: 2,
            jobId: 'quality',
            jobName: '静态检查与单元测试',
            name: '类型检查与单元测试',
            kind: 'run',
            status: 'succeeded',
            startedAt: '2026/11/26 17:10:39',
            finishedAt: '2026/11/26 17:11:21',
            durationSeconds: 42,
            exitCode: 0,
            logs: [
              {
                time: '17:11:21',
                text: '✓ 28 test files passed (214 tests) · UI baseline 0 新增违规',
                level: 'success',
              },
            ],
          },
        ],
      },
      {
        id: 'package',
        name: '生产构建与产物归档',
        runsOn: 'linux-docker',
        needs: ['quality'],
        status: 'succeeded',
        nodeName: 'linux-docker-01',
        durationSeconds: 58,
        steps: [
          {
            index: 3,
            jobId: 'package',
            jobName: '生产构建与产物归档',
            name: '检出代码',
            kind: 'builtin_checkout',
            status: 'succeeded',
            startedAt: '2026/11/26 17:11:21',
            finishedAt: '2026/11/26 17:11:27',
            durationSeconds: 6,
            exitCode: 0,
            logs: [{ time: '17:11:27', text: '✓ 已检出提交 fe834ff2', level: 'success' }],
          },
          {
            index: 4,
            jobId: 'package',
            jobName: '生产构建与产物归档',
            name: '打包生产静态资源',
            kind: 'run',
            status: 'succeeded',
            startedAt: '2026/11/26 17:11:27',
            finishedAt: '2026/11/26 17:12:09',
            durationSeconds: 42,
            exitCode: 0,
            logs: [{ time: '17:12:09', text: '✓ apps/web/dist 构建成功（总计 1.84 MB）', level: 'success' }],
          },
          {
            index: 5,
            jobId: 'package',
            jobName: '生产构建与产物归档',
            name: '上传 web-dist 产物',
            kind: 'builtin_upload_artifact',
            status: 'succeeded',
            startedAt: '2026/11/26 17:12:09',
            finishedAt: '2026/11/26 17:12:19',
            durationSeconds: 10,
            exitCode: 0,
            logs: [{ time: '17:12:19', text: '✓ 已上传 web-dist-fe834ff2.tar.gz', level: 'success' }],
          },
        ],
      },
    ],
    artifacts: [
      {
        id: 'art-15-1',
        name: 'web-dist-fe834ff2.tar.gz',
        stepIndex: 5,
        stepName: '上传 web-dist 产物',
        sizeLabel: '1.84 MB',
        sha256: '4d28b0c1e9fa4412c088d7a104f92be13ac97011',
        createdAt: '2026/11/26 17:12',
        retentionDays: 14,
      },
      {
        id: 'art-15-2',
        name: 'vitest-summary.json',
        stepIndex: 2,
        stepName: '类型检查与单元测试',
        sizeLabel: '42.1 KB',
        sha256: '71a9cc3284f01b5290d11e7b8421a9043c12f801',
        createdAt: '2026/11/26 17:11',
        retentionDays: 14,
      },
    ],
    yamlSnapshot: WEB_CI_YAML,
  },
  {
    id: 'run-14',
    runNumber: 14,
    shortId: '5b12f903',
    projectId: 'dev-ops',
    workflowPath: '.devops/workflows/docker-image-release.yml',
    workflowName: 'docker-image-release',
    ref: 'main',
    commitSha: 'fe834ff29910e43b77d211c8a91b22014c8f10ab',
    commitMessage: 'chore(release): 构建 server v0.4.2 容器镜像',
    status: 'queued',
    triggerSource: 'manual',
    initiator: '周宁',
    initiatorChannel: 'Web 页面',
    nodeName: null,
    nodeTag: 'docker-buildx',
    createdAt: '2026/11/26 19:21',
    relativeTime: '4 分钟前',
    startedAt: null,
    finishedAt: null,
    durationSeconds: null,
    inputs: { service: 'server', tag: 'v0.4.2', push_latest: false },
    errorMessage: '当前没有匹配能力标签 docker-buildx 的在线执行节点（docker-buildx-01 离线）。',
    jobs: [
      {
        id: 'image',
        name: '构建并推送容器镜像',
        runsOn: 'docker-buildx',
        needs: [],
        status: 'pending',
        nodeName: null,
        durationSeconds: null,
        steps: [
          {
            index: 0,
            jobId: 'image',
            jobName: '构建并推送容器镜像',
            name: '检出代码',
            kind: 'builtin_checkout',
            status: 'pending',
            startedAt: null,
            finishedAt: null,
            durationSeconds: null,
            exitCode: null,
            logs: [],
          },
          {
            index: 1,
            jobId: 'image',
            jobName: '构建并推送容器镜像',
            name: 'BuildKit 多架构构建',
            kind: 'run',
            status: 'pending',
            startedAt: null,
            finishedAt: null,
            durationSeconds: null,
            exitCode: null,
            logs: [],
          },
          {
            index: 2,
            jobId: 'image',
            jobName: '构建并推送容器镜像',
            name: '推送至私有镜像仓库',
            kind: 'run',
            status: 'pending',
            startedAt: null,
            finishedAt: null,
            durationSeconds: null,
            exitCode: null,
            logs: [],
          },
        ],
      },
    ],
    artifacts: [],
    yamlSnapshot: DOCKER_RELEASE_YAML,
  },
  {
    id: 'run-13',
    runNumber: 13,
    shortId: '91bc4410',
    projectId: 'dev-ops',
    workflowPath: '.devops/workflows/docker-image-release.yml',
    workflowName: 'docker-image-release',
    ref: 'release/v0.4',
    commitSha: 'd83af6880a2c5f9b4d31e7741a2b69cc40f12981',
    commitMessage: 'build(docker): 升级 Node 24.15 生产基础镜像',
    status: 'interrupted',
    triggerSource: 'manual',
    initiator: '周宁',
    initiatorChannel: 'Web 页面',
    nodeName: 'docker-buildx-01',
    nodeTag: 'docker-buildx',
    createdAt: '2026/11/25 22:08',
    relativeTime: '昨天 22:08',
    startedAt: '2026/11/25 22:08:11',
    finishedAt: '2026/11/25 22:11:42',
    durationSeconds: 211,
    inputs: { service: 'server', tag: 'v0.4.1', push_latest: true },
    errorCode: 'NODE_LEASE_EXPIRED',
    errorMessage: '执行节点 docker-buildx-01 心跳超时，租约过期；已保留前两步完整日志，可重新运行。',
    jobs: [
      {
        id: 'image',
        name: '构建并推送容器镜像',
        runsOn: 'docker-buildx',
        needs: [],
        status: 'interrupted',
        nodeName: 'docker-buildx-01',
        durationSeconds: 211,
        steps: [
          {
            index: 0,
            jobId: 'image',
            jobName: '构建并推送容器镜像',
            name: '检出代码',
            kind: 'builtin_checkout',
            status: 'succeeded',
            startedAt: '2026/11/25 22:08:11',
            finishedAt: '2026/11/25 22:08:20',
            durationSeconds: 9,
            exitCode: 0,
            logs: [{ time: '22:08:20', text: '✓ 已检出分支 release/v0.4 @ d83af688', level: 'success' }],
          },
          {
            index: 1,
            jobId: 'image',
            jobName: '构建并推送容器镜像',
            name: 'BuildKit 多架构构建',
            kind: 'run',
            status: 'interrupted',
            startedAt: '2026/11/25 22:08:20',
            finishedAt: '2026/11/25 22:11:42',
            durationSeconds: 202,
            exitCode: null,
            errorCode: 'NODE_LEASE_EXPIRED',
            errorMessage: '节点 docker-buildx-01 失联超过 90 秒',
            logs: [
              {
                time: '22:08:20',
                text: '$ docker buildx build --target server -t registry.internal/devops-server:v0.4.1 .',
                level: 'cmd',
              },
              { time: '22:09:45', text: '#11 [builder 4/6] RUN pnpm --filter @dev-ops/server build', level: 'info' },
              {
                time: '22:11:42',
                text: '⚠ 节点心跳超时（NODE_LEASE_EXPIRED），平台已停止等待该运行。',
                level: 'error',
              },
            ],
          },
          {
            index: 2,
            jobId: 'image',
            jobName: '构建并推送容器镜像',
            name: '推送至私有镜像仓库',
            kind: 'run',
            status: 'cancelled',
            startedAt: null,
            finishedAt: null,
            durationSeconds: null,
            exitCode: null,
            logs: [],
          },
        ],
      },
    ],
    artifacts: [],
    yamlSnapshot: DOCKER_RELEASE_YAML,
  },
  {
    id: 'run-m4',
    runNumber: 4,
    shortId: '3f09aa12',
    projectId: 'mobile-app',
    workflowPath: '.devops/workflows/flutter-android-apk.yml',
    workflowName: 'flutter-android-apk',
    ref: 'main',
    commitSha: '4a92c1e89b103f7a62d88e10421b9d73ac510f20',
    commitMessage: 'feat(mobile): 适配移动端登录态恢复与离线提示',
    status: 'succeeded',
    triggerSource: 'manual',
    initiator: '周宁',
    initiatorChannel: 'Web 页面',
    nodeName: 'linux-docker-01',
    nodeTag: 'linux-docker',
    createdAt: '2026/11/26 16:05',
    relativeTime: '3 小时前',
    startedAt: '2026/11/26 16:05:10',
    finishedAt: '2026/11/26 16:08:52',
    durationSeconds: 222,
    inputs: { flavor: 'staging' },
    jobs: [
      {
        id: 'android',
        name: 'Android 安装包构建',
        runsOn: 'linux-docker',
        needs: [],
        status: 'succeeded',
        nodeName: 'linux-docker-01',
        durationSeconds: 222,
        steps: [
          {
            index: 0,
            jobId: 'android',
            jobName: 'Android 安装包构建',
            name: '检出代码',
            kind: 'builtin_checkout',
            status: 'succeeded',
            startedAt: '2026/11/26 16:05:10',
            finishedAt: '2026/11/26 16:05:22',
            durationSeconds: 12,
            exitCode: 0,
            logs: [{ time: '16:05:22', text: '✓ 已检出提交 4a92c1e8', level: 'success' }],
          },
          {
            index: 1,
            jobId: 'android',
            jobName: 'Android 安装包构建',
            name: 'Flutter 依赖与测试',
            kind: 'run',
            status: 'succeeded',
            startedAt: '2026/11/26 16:05:22',
            finishedAt: '2026/11/26 16:06:15',
            durationSeconds: 53,
            exitCode: 0,
            logs: [{ time: '16:06:15', text: '✓ All 46 tests passed!', level: 'success' }],
          },
          {
            index: 2,
            jobId: 'android',
            jobName: 'Android 安装包构建',
            name: '构建 Release APK',
            kind: 'run',
            status: 'succeeded',
            startedAt: '2026/11/26 16:06:15',
            finishedAt: '2026/11/26 16:08:38',
            durationSeconds: 143,
            exitCode: 0,
            logs: [
              {
                time: '16:08:38',
                text: '✓ Built build/app/outputs/flutter-apk/app-release.apk (24.6MB)',
                level: 'success',
              },
            ],
          },
          {
            index: 3,
            jobId: 'android',
            jobName: 'Android 安装包构建',
            name: '上传 APK 产物',
            kind: 'builtin_upload_artifact',
            status: 'succeeded',
            startedAt: '2026/11/26 16:08:38',
            finishedAt: '2026/11/26 16:08:52',
            durationSeconds: 14,
            exitCode: 0,
            logs: [{ time: '16:08:52', text: '✓ 已上传 app-release-apk (24.6 MB)', level: 'success' }],
          },
        ],
      },
    ],
    artifacts: [
      {
        id: 'art-m4-1',
        name: 'app-release-staging.apk',
        stepIndex: 3,
        stepName: '上传 APK 产物',
        sizeLabel: '24.6 MB',
        sha256: 'c1028d774fa2390b18e6a11092cc4a31845f902e',
        createdAt: '2026/11/26 16:08',
        retentionDays: 30,
      },
    ],
    yamlSnapshot: MOBILE_APK_YAML,
  },
]

/**
 * 展平某次运行内所有 Job 下的步骤列表，按步骤序号升序返回。
 * @param run 流水线运行记录。
 * @returns 扁平步骤数组。
 */
export function flattenRunSteps(run: ProtoPipelineRun): ProtoPipelineStepRun[] {
  return run.jobs.flatMap((job) => job.steps).sort((a, b) => a.index - b.index)
}

/**
 * 统计某次运行已完成的步骤数量与总步骤数量。
 * @param run 流水线运行记录。
 * @returns 已结束（成功/失败/中断/跳过/取消）和总步骤计数。
 */
export function countRunStepProgress(run: ProtoPipelineRun): { completed: number; succeeded: number; total: number } {
  const steps = flattenRunSteps(run)
  const completed = steps.filter((step) => step.status !== 'pending' && step.status !== 'running').length
  const succeeded = steps.filter((step) => step.status === 'succeeded').length
  return { completed, succeeded, total: steps.length }
}
