# 项目开发平台

产品定位、已确认需求及待定事项见[项目管理与运维平台需求](docs/prd/mvp.md)。

模块划分、功能优先级和版本验收见[需求版本规划](docs/prd/release-plan.md)，当前为规划草案。

全项目的模块图、功能图和逻辑区域架构图见[项目结构图](docs/prd/project-maps.md)，可直接编辑 Mermaid 源图。

首版功能清单、业务流程、验收标准和待确认问题见 [V0.1 需求细化](docs/prd/v0.1.md)。

平台内置流水线的整体方案、执行节点架构、版本安排与待确认决策见[流水线功能规划草案](docs/prd/pipeline-plan.md)，当前为规划草案。

全新的工作区结构、Web 与 Server 模块边界及搭建范围见[目标架构方案](docs/architecture/system-design.md)，目标方案已确认，工作区和基础工程已搭建，业务模块按实际需求加入。

GitHub App 授权、成员与 Bot 的权限和凭据、统一 Git 接口及执行流程见[外部仓库集成架构](docs/architecture/external-repositories.md)。首批适配范围为 GitHub、Gitea，GitLab、Gitee、Codeup 预留扩展；当前为待实施验证的架构设计。

Git 连接、仓库/PR 读取与自研流水线的分层结构见[Git、PR 与流水线架构](docs/architecture/code-pr-pipeline-architecture.md)，含 Mermaid 组件图与时序图。

平台内 Bot 的执行方案见 [Bots 轻量执行架构](docs/architecture/bots-architecture.md)：Server 保存协作数据并鉴权，Server 包内的 bot-worker 进程调用可复用的开源库 [devops-bot](https://github.com/aiShuiJiaoDeXioShou/devops-bot)（Git 子模块 `packages/devops-bot`，克隆后运行 `git submodule update --init`）执行，含模型连接、记忆、权限与实施顺序。

多种原生运行时并列接入的早期草案见 [Bots 运行时适配契约与示例](docs/architecture/bots-runtime-examples.md)，V0.5 不采用。

前后端推荐组件、集成方式、测试方案和待补齐内容见[技术选型与集成方案](docs/technical-selection.md)。截至 2026-11-10，V0.1、V0.2、V0.3 阶段 A 与 V0.4a 已交付；下一版本为 V0.4b（流水线部署与产品发布），Bot 与运维后移；2026-11-17 已建立 V0.5 Bot 协作规格（`specs/009-v05-bot-collaboration/`，本地目录），版本状态见[需求版本规划](docs/prd/release-plan.md)。

界面与主要操作可查看 [HTML 交互原型](docs/desgin/interactive-prototype-v1/index.html)，打开方式和演示边界见[原型说明](docs/desgin/interactive-prototype-v1/README.md)。

Web UI 的 token、组件选择、页面模式、交互规范和 AI 实现约束见[设计规范](docs/design/DESIGN.md)；修改 UI 后运行 `pnpm ui:check`。

安装依赖后，在仓库根目录运行 `pnpm dev:prototype`，然后访问 http://127.0.0.1:4178/；按 `Ctrl+C` 停止服务。

前端位于 [apps/web](apps/web/README.md)，后端位于 [apps/server](apps/server/README.md)，命令行工具位于 [apps/cli](apps/cli/README.md)。应用各自声明依赖，共用根目录工作区与锁文件，协作规则见 [AGENTS.md](AGENTS.md)。

在仓库根目录初始化依赖和本地数据库：

```bash
nvm use
git submodule update --init
pnpm install --frozen-lockfile
pnpm db:setup
pnpm db:up
pnpm db:migrate
pnpm dev
```

`pnpm dev` 先生成并构建 API 客户端，再同时启动 Web 和 Server。默认 Web 地址为 `http://localhost:5173`，API 为 `http://127.0.0.1:3001`。也可以分别运行 `pnpm dev:web`、`pnpm dev:server`。开发代理地址可用启动进程环境变量 `DEV_OPS_API_TARGET` 指定。

同时调试 Web、HTTP 服务、调度 Worker、Bot Worker 和流水线 Agent 时，在仓库根目录运行 `pnpm dev:all`。先启动 Docker，并按上面的步骤启动和迁移本地 PostgreSQL。将节点令牌、平台地址、工作目录和标签写入 `apps/pipeline-agent/.env`。Agent 会等待 API 就绪后再启动，按 `Ctrl+C` 可停止本次启动的进程。节点配置见[流水线 Agent 开发说明](apps/pipeline-agent/README.md#配置)。

V0.4a 内置流水线还需要两个独立进程：调度 Worker 与自托管执行节点 Agent。Worker 用 PostgreSQL 行锁和租约调度运行、监控超时并收口节点离线，需在 Server 之外单独启动：

```bash
pnpm --dir apps/server dev:worker
```

执行 Linux 流水线的节点需要一台可用的 Docker 主机，在团队设置 → 连接与节点中创建节点并复制一次性注册令牌，然后以环境变量启动 Agent（也可写入 agent 本地 `.env`）。平台地址、节点令牌与工作目录等配置见 [apps/pipeline-agent/README.md](apps/pipeline-agent/README.md)，日志与产物保存在 `PIPELINE_STORAGE_DIR` 指向的受控目录：

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

本地安装依赖前先检出 `packages/devops-bot` 子模块；`pnpm check:bot-submodule` 可单独检查。GitHub Actions 的递归检出需要 `DEVOPS_BOT_CHECKOUT_TOKEN`（对父仓库与私有子模块均有 Contents 只读权限）。

`pnpm check` 从后端 TypeBox 路由导出契约，生成 API 类型及独立校验器，构建所有应用，检查模块依赖，再运行工程、应用和跨应用联通测试。除 `test:db` 外，无需预先启动数据库或后端。`pnpm test:db` 使用本机 PostgreSQL，在隔离测试库中验证迁移、权限与事务，结束后删除测试库。

`pnpm build` 只执行契约生成和全部构建。单独检查某个应用前先执行 `pnpm prepare:clients`；运行端到端测试 `pnpm test:e2e` 前先完成 `pnpm build`。

后端配置和接口见[后端说明](apps/server/README.md)。本地 Compose 将 PostgreSQL 绑定到 `127.0.0.1:5433`，配置见 [deploy](deploy/README.md)，数据和迁移操作见[数据库说明](docs/architecture/database.md)。共享客户端与工程工具分别见 [API 客户端](packages/api-client/README.md)和[工程工具](tooling/README.md)。

## Mac mini 原生部署

Mac mini 可以原生运行 HTTP API、调度 Worker 和 Bot Worker。Web 由宿主机网关直接提供 `apps/web/dist` 中的静态文件，数据库使用本机或远程 PostgreSQL 18。这些服务可以完全在 Docker 之外运行。Linux 流水线任务使用 Docker 执行节点。Mac mini 可以同时运行 [专用 macOS 原生发布节点](deploy/native/README.md)，构建并更新当前原生部署。

### 构建产物

在仓库根目录使用 `.nvmrc` 和根 `package.json` 固定的 Node.js、pnpm 版本。首次构建先编译 API 契约生成所依赖的工作区包。

```bash
nvm use
git submodule update --init
pnpm install --frozen-lockfile
pnpm --filter @dev-ops/pipeline-protocol --filter @dev-ops/devops-bot build
pnpm build
```

部署后端时保留 `apps/server/dist`、`apps/server/drizzle` 和 Node.js 运行依赖，包括工作区包。

### 数据库与应用配置

本机数据库可通过 `brew install postgresql@18` 安装。先在该实例的 `postgresql.conf` 中设置 `listen_addresses = 'localhost'` 和空闲端口，再启动服务。下例使用 `5433`。宿主机已有其他 PostgreSQL 实例时，为 18 使用独立的数据目录和端口。 [Homebrew PostgreSQL 18 安装说明](https://formulae.brew.sh/formula/postgresql%4018)

在空实例上，由数据库管理员创建 `dev_ops` 数据库。在执行初始化脚本的环境中提供独立的 `APP_DATABASE_PASSWORD` 和 `MIGRATION_DATABASE_PASSWORD`，脚本会安装 `pg_trgm` 并创建、授权两个登录角色。

```bash
brew services start postgresql@18
pg18_bin="$(brew --prefix postgresql@18)/bin"
"$pg18_bin/createdb" -h 127.0.0.1 -p 5433 dev_ops
"$pg18_bin/psql" -h 127.0.0.1 -p 5433 -d dev_ops -v ON_ERROR_STOP=1 -f deploy/postgres/init.sql
```

使用远程 PostgreSQL 18 时，由管理员按同样的角色和扩展要求初始化，并按数据库服务要求启用 TLS。已有部署升级时，先备份，再执行迁移。权限和迁移流程见[数据库说明](docs/architecture/database.md#部署边界)。

在 `apps/server/.env.database` 配置迁移账号的 `MIGRATION_DATABASE_URL`。参照[后端环境变量表](apps/server/README.md#环境变量)配置 `apps/server/.env`，供三个常驻进程使用。限制配置文件的读取权限。

- 设置 `NODE_ENV=production`、`HOST=127.0.0.1` 和 API 端口。`APP_ORIGIN` 填用户实际访问的 HTTPS 源。
- `DATABASE_URL` 使用 `dev_ops_app` 的连接地址。设置持久的 `AUTH_SECRET` 和 `GIT_CREDENTIAL_ENCRYPTION_KEY`，以便重启后继续验证会话和解密已有凭据。
- `PIPELINE_STORAGE_DIR`、`ATTACHMENT_STORAGE_DIR` 和 `BOT_WORKSPACE_DIR` 使用发布目录外的绝对路径，授予运行用户所需权限。备份数据库时一并保留业务文件和解密所需的密钥。

### 迁移与启动

在三个服务启动前先迁移数据库。首次安装通过 `ROOT_EMAIL` 和 `ROOT_INITIAL_PASSWORD` 向 root 初始化命令提供凭据。

```bash
pnpm db:migrate
pnpm --dir apps/server seed:root
```

手动验证时，在独立终端分别执行以下命令。

```bash
pnpm --dir apps/server start
pnpm --dir apps/server start:worker
pnpm --dir apps/server start:bot-worker
```

长驻部署使用 `launchd` 分别守护 `dist/entrypoints` 下的 `http.js`、`worker.js` 和 `bot-worker.js`。各任务以专用用户运行，将 `WorkingDirectory` 指向 `apps/server` 的绝对路径。`ProgramArguments` 依次填写 Node.js 的绝对路径、`--env-file`、应用配置文件的绝对路径和入口脚本的绝对路径。

需要开机启动时，将三个配置放在 `/Library/LaunchDaemons`，各自设置独立的 `Label`、`UserName` 和 `KeepAlive`，通过 `sudo launchctl bootstrap system <plist路径>` 加载。上面的 `brew services start` 默认在用户登录时启动数据库。如果整套服务需要在登录前运行，数据库和网关也应配置为开机启动。

### 网关与验证

宿主机的 HTTPS 网关使用 `apps/web/dist` 作为静态根目录，并将 `/api/` 原路径转发到 `127.0.0.1:3001`。以下配置放在原生 Nginx 的 HTTPS `server` 块内。按部署路径替换 `root`，按上传限制调整 `client_max_body_size`。

```nginx
root /absolute/path/to/dev-ops/apps/web/dist;

location / {
    try_files $uri $uri/ /index.html;
}

location /api/ {
    proxy_pass http://127.0.0.1:3001;
    proxy_http_version 1.1;
    proxy_set_header Host $http_host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_request_buffering off;
    proxy_buffering off;
    client_max_body_size 500m;
}
```

请求 `http://127.0.0.1:3001/api/v1/ready`，确认响应体的 `success` 为 `true`。再从公开地址验证 `/api/v1/ready` 和直接打开 `/login`，确认 API 转发与前端路由回退生效。查看两个 Worker 的启动日志，确认服务已进入轮询。启用流水线时，另行确认 [Agent 节点](apps/pipeline-agent/README.md#启动)在线。

## V0.5.0 Bot 协作

登录后从「协作」进入私聊、群组、任务和待处理，从「能力」维护智能体、Skills、长期记忆与模型连接。启动后端时同时运行 HTTP 服务、调度 Worker 和 [Bot 执行服务](apps/server/README.md#bot-执行服务)。它们共享 [PostgreSQL 迁移与数据](docs/architecture/database.md#v05-bot-协作)。
