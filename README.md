# 项目开发平台

产品定位、已确认需求及待定事项见[项目管理与运维平台需求](docs/prd/mvp.md)。

模块划分、功能优先级和版本验收见[需求版本规划](docs/prd/release-plan.md)，当前为规划草案。

全项目的模块图、功能图和逻辑区域架构图见[项目结构图](docs/prd/project-maps.md)，可直接编辑 Mermaid 源图。

首版功能清单、业务流程、验收标准和待确认问题见 [V0.1 需求细化](docs/prd/v0.1.md)。

平台内置流水线的整体方案、执行节点架构、版本安排与待确认决策见[流水线功能规划草案](docs/prd/pipeline-plan.md)，当前为规划草案。

全新的工作区结构、Web 与 Server 模块边界及搭建范围见[目标架构方案](docs/architecture/system-design.md)，目标方案已确认，工作区和基础工程已搭建，业务模块按实际需求加入。

GitHub App 授权、成员与 Bot 的权限和凭据、统一 Git 接口及执行流程见[外部仓库集成架构](docs/architecture/external-repositories.md)。首批适配范围为 GitHub、Gitea，GitLab、Gitee、Codeup 预留扩展；当前为待实施验证的架构设计。

Git 连接、仓库/PR 读取与自研流水线的分层结构见[Git、PR 与流水线架构](docs/architecture/code-pr-pipeline-architecture.md)，含 Mermaid 组件图与时序图。

独立 Bot、会话、任务、Agent 执行与平台 API 隔离的建议见 [Bots 独立子系统架构草案](docs/architecture/bots-architecture.md)，包含开源参考、权限边界、恢复机制与实施顺序。

运行时内部端口、原生协议映射、双向事件及控制顺序见 [Bots 运行时适配契约与示例](docs/architecture/bots-runtime-examples.md)。

轻量个人 Bot 首版已初始化在 [apps/bot](apps/bot/README.md)，使用 pi、DeepSeek 与 SQLite；运行 `pnpm --dir apps/bot dev chat` 开始对话。

前后端推荐组件、集成方式、测试方案和待补齐内容见[技术选型与集成方案](docs/technical-selection.md)。截至 2026-11-10，V0.1、V0.2、V0.3 阶段 A 与 V0.4a 已交付；下一版本为 V0.4b（流水线部署与产品发布），Bot 与运维后移，版本状态见[需求版本规划](docs/prd/release-plan.md)。

界面与主要操作可查看 [HTML 交互原型](docs/desgin/interactive-prototype-v1/index.html)，打开方式和演示边界见[原型说明](docs/desgin/interactive-prototype-v1/README.md)。

Web UI 的 token、组件选择、页面模式、交互规范和 AI 实现约束见[设计规范](docs/design/DESIGN.md)；修改 UI 后运行 `pnpm ui:check`。

安装依赖后，在仓库根目录运行 `pnpm dev:prototype`，然后访问 http://127.0.0.1:4178/；按 `Ctrl+C` 停止服务。

前端位于 [apps/web](apps/web/README.md)，后端位于 [apps/server](apps/server/README.md)，命令行工具位于 [apps/cli](apps/cli/README.md)。应用各自声明依赖，共用根目录工作区与锁文件，协作规则见 [AGENTS.md](AGENTS.md)。

在仓库根目录初始化依赖和本地数据库：

```bash
nvm use
pnpm install --frozen-lockfile
pnpm db:setup
pnpm db:up
pnpm db:migrate
pnpm dev
```

`pnpm dev` 先生成并构建 API 客户端，再同时启动 Web 和 Server。默认 Web 地址为 `http://localhost:5173`，API 为 `http://127.0.0.1:3001`。也可以分别运行 `pnpm dev:web`、`pnpm dev:server`。开发代理地址可用启动进程环境变量 `DEV_OPS_API_TARGET` 指定。

V0.4a 内置流水线还需要两个独立进程：调度 Worker 与自托管执行节点 Agent。Worker 用 PostgreSQL 行锁和租约调度运行、监控超时并收口节点离线，需在 Server 之外单独启动：

```bash
pnpm --dir apps/server dev:worker
```

执行节点需要一台可用的 Docker 主机（P1 为本地开发机），在团队设置 → 连接与节点中创建节点并复制一次性注册令牌，然后以环境变量启动 Agent（也可写入 agent 本地 `.env`）。平台地址、节点令牌与工作目录等配置见 [apps/pipeline-agent/README.md](apps/pipeline-agent/README.md)，日志与产物保存在 `PIPELINE_STORAGE_DIR` 指向的受控目录：

```bash
PLATFORM_URL=http://127.0.0.1:3001 \
AGENT_REGISTRATION_TOKEN=<一次性令牌> \
AGENT_WORK_DIR=/tmp/devops-agent \
AGENT_LABELS=linux,docker,node24 \
pnpm dev:agent
```

仓库内 `.devops/workflows/` 中的 YAML 工作流按[平台支持的子集](specs/005-v04a-pipeline-runner/contracts/workflow-yaml.md)解析；语法不支持、节点离线、步骤超时与取消都会显式失败或中断，不会显示为成功。完整步骤见[内置流水线验收指南](specs/005-v04a-pipeline-runner/quickstart.md)。

CLI 首次使用前执行 `pnpm prepare:clients`，之后查看帮助或检查运行中的服务：

```bash
pnpm cli --help
pnpm cli health --json
```

V0.1 本地初始化和验证：

```bash
pnpm db:setup
pnpm db:up
pnpm db:migrate
pnpm --dir apps/server seed:root   # 使用 apps/server/.env 的 ROOT_EMAIL / ROOT_INITIAL_PASSWORD
pnpm test:db
pnpm test:e2e
```

本地邮件默认使用 Mailpit 地址 `smtp://127.0.0.1:1025`（需自行启动 Mailpit）；stg 使用 Resend 时在 `apps/server/.env` 配置 `SMTP_URL` 与 `MAIL_FROM`。root 种子命令只在首次创建账号时使用密码，不写入业务表。

完整验证与构建命令：

```bash
pnpm check
pnpm test:db
```

`pnpm check` 从后端 TypeBox 路由导出契约，生成 API 类型及独立校验器，构建所有应用，检查模块依赖，再运行工程、应用和跨应用联通测试。除 `test:db` 外，无需预先启动数据库或后端。`pnpm test:db` 使用本机 PostgreSQL，在隔离测试库中验证迁移、权限与事务，结束后删除测试库。

`pnpm build` 只执行契约生成和全部构建。单独检查某个应用前先执行 `pnpm prepare:clients`；运行端到端测试 `pnpm test:e2e` 前先完成 `pnpm build`。

后端配置和接口见[后端说明](apps/server/README.md)。PostgreSQL 默认监听 `127.0.0.1:5433`，部署配置位于 [deploy](deploy/README.md)，数据和迁移操作见[数据库说明](docs/architecture/database.md)。共享客户端与工程工具分别见 [API 客户端](packages/api-client/README.md)和[工程工具](tooling/README.md)。
