# TypeScript 后端

[bootstrap/create-http-app.ts](src/bootstrap/create-http-app.ts) 组装 Fastify 应用，[entrypoints/http.ts](src/entrypoints/http.ts) 启动 HTTP 服务并处理退出信号。应用通过 `app.db` 提供 Drizzle 数据访问，包含存活检查、数据库就绪检查和开发环境接口文档。业务模块按需添加到 `src/modules/`。

## 开发与验证

在仓库根目录运行 `nvm use`，使用 [.nvmrc](../../.nvmrc) 指定的 Node 版本。pnpm 版本由 [package.json](package.json) 固定。

```bash
pnpm install --frozen-lockfile
pnpm --dir apps/server db:setup
pnpm --dir apps/server db:up
pnpm --dir apps/server db:migrate
pnpm --dir apps/server dev
```

`db:setup` 生成包含随机密码的本地配置，已有配置不会被覆盖。应用要求提供 `DATABASE_URL`，配置项见 [.env.example](.env.example)；系统环境变量优先。启动脚本读取 `apps/server/.env`，配置校验失败会阻止启动。迁移账号单独保存在 `apps/server/.env.database`，应用启动不加载它。完整操作见[数据库说明](../../docs/architecture/database.md)。

| 命令（在仓库根目录执行）           | 用途             | 输出或行为                                    |
| ---------------------------------- | ---------------- | --------------------------------------------- |
| `pnpm --dir apps/server dev`       | 本地开发         | 监听源码变化并重启                            |
| `pnpm --dir apps/server check`     | 提交前检查       | 类型检查、Oxlint、接口与配置测试              |
| `pnpm --dir apps/server build`     | 编译服务         | 输出 ESM JavaScript 到 `dist/`                |
| `pnpm --dir apps/server start`     | 运行编译产物     | 需先执行 build                                |
| `pnpm --dir apps/server typecheck` | 单独检查类型     | 包含源码和测试                                |
| `pnpm --dir apps/server lint`      | 单独检查代码规范 | 使用 `.oxlintrc.json`                         |
| `pnpm --dir apps/server test`      | 单独运行测试     | 不依赖数据库的接口与配置测试                  |
| `pnpm --dir apps/server test:db`   | 数据库集成测试   | 需要本地 PostgreSQL，自动创建并删除独立测试库 |

部署时将 `NODE_ENV` 设置为 `production`。容器中需要将 `HOST` 设置为 `0.0.0.0`；默认地址只监听本机。

## 接口与前端联调

默认监听 `http://127.0.0.1:3001`，以下路径由 [HTTP 组装入口](src/bootstrap/create-http-app.ts) 和[健康检查模块](src/modules/health/health.routes.ts) 注册。

| 方法与路径           | 用途             | 返回内容                                                                   |
| -------------------- | ---------------- | -------------------------------------------------------------------------- |
| `GET /api/v1/health` | 进程存活检查     | HTTP 200 信封，`data.status` 为 `ok`，不检查数据库                         |
| `GET /api/v1/ready`  | 数据库就绪检查   | HTTP 200 信封；数据库不可用时 `success:false`、`code:DATABASE_UNAVAILABLE` |
| `GET /docs/`         | 开发环境交互文档 | Swagger UI                                                                 |
| `GET /docs/json`     | 导出接口契约     | OpenAPI JSON                                                               |

前端 [Vite 配置](../web/vite.config.ts) 将 `/api` 请求代理到默认后端地址。启动前后端后，页面通过共享 API 客户端调用服务。修改后端端口时，用 `DEV_OPS_API_TARGET` 配置 Vite 开发代理。

该代理仅用于 Vite 开发服务器。部署时需要在网关配置同源 `/api` 转发。接口文档通过后端地址访问。

项目首页用 `GET /api/v1/teams/:teamId/project-repositories` 分页读取该团队项目已关联的仓库。同一仓库关联多个项目时只返回一个选项。`GET /api/v1/teams/:teamId/projects` 和 `GET /api/v1/teams/:teamId/project-activity` 共用 `status`、`search`、`ownerId`、`ownerUnavailable`、`repositoryId` 和 `hasRepository`。多个条件同时匹配后再分页或聚合。通过 `hasRepository=false` 查未关联仓库的项目，通过 `ownerUnavailable=true` 查负责人已失效的项目。

## 环境变量

配置定义位于 [platform/config/env.ts](src/platform/config/env.ts)，非法值会阻止服务启动。端口接受范围为 1 到 65535 的整数。

| 变量                             | 默认值                            | 用途                                                              |
| -------------------------------- | --------------------------------- | ----------------------------------------------------------------- |
| `NODE_ENV`                       | `development`                     | 可选 `development`、`test`、`production`                          |
| `HOST`                           | `127.0.0.1`                       | HTTP 监听地址                                                     |
| `PORT`                           | `3001`                            | HTTP 监听端口                                                     |
| `LOG_LEVEL`                      | `info`                            | 可选 `fatal`、`error`、`warn`、`info`、`debug`、`trace`、`silent` |
| `DOCS_ENABLED`                   | 生产环境 `false`，其他环境 `true` | 显式设置 `true` 或 `false` 控制接口文档                           |
| `DATABASE_URL`                   | 必填                              | 应用账号的 PostgreSQL URL，必须包含主机和库名                     |
| `DB_POOL_MAX`                    | `10`                              | 每个后端进程的连接池上限，范围 1-100                              |
| `DB_CONNECT_TIMEOUT_MS`          | `5000`                            | 获取连接超时，范围 1-60000 毫秒                                   |
| `DB_IDLE_TIMEOUT_MS`             | `30000`                           | 空闲连接回收时间，范围 1-600000 毫秒                              |
| `DB_STATEMENT_TIMEOUT_MS`        | `10000`                           | 数据库语句超时，范围 1-300000 毫秒                                |
| `DB_LOCK_TIMEOUT_MS`             | `3000`                            | 数据库锁等待超时，范围 1-60000 毫秒                               |
| `DB_IDLE_TRANSACTION_TIMEOUT_MS` | `30000`                           | 空闲事务会话超时，范围 1-600000 毫秒                              |
| `APP_ORIGIN`                     | `http://localhost:5173`           | Web 对外源，用于认证、邮件链接与可信来源                          |
| `AUTH_SECRET`                    | 未设置                            | Better Auth 会话/Cookie 签名密钥；启用认证后必须配置且保持稳定    |
| `AUTH_TRUSTED_ORIGINS`           | `APP_ORIGIN`                      | 浏览器来源白名单，逗号分隔；未包含 `APP_ORIGIN` 时自动补入        |
| `SMTP_URL`                       | 未设置                            | SMTP 提交地址；本地 Mailpit 为 `smtp://127.0.0.1:1025`            |
| `MAIL_FROM`                      | 未设置                            | 邀请与密码找回发件人                                              |
| `GIT_CREDENTIAL_ENCRYPTION_KEY`  | 未设置                            | 32 字节 base64，Git 凭据 AES-256-GCM 加密密钥                     |
| `GITHUB_ALLOWED_REPOS`           | 空                                | 可选仓库白名单，逗号分隔 `owner/repo`；留空时使用 App 安装范围    |
| `GITHUB_APP_ID`                  | 未设置                            | GitHub App ID，用于签发安装令牌                                   |
| `GITHUB_APP_PRIVATE_KEY_PATH`    | 未设置                            | GitHub App 私钥文件路径                                           |
| `GITHUB_APP_SLUG`                | 未设置                            | GitHub App 安装入口 slug                                          |
| `GITHUB_APP_CLIENT_ID`           | 未设置                            | GitHub App 的用户授权客户端标识                                   |
| `GITHUB_APP_CLIENT_SECRET`       | 未设置                            | GitHub App 的用户授权客户端密钥                                   |
| `ATTACHMENT_STORAGE_DIR`         | `./attachment-data`               | 本地储存桶根目录；需可写并纳入备份                                |
| `ATTACHMENT_MAX_BYTES`           | `52428800`                        | 单附件上限（字节），范围 1 MB–2 GB                                |
| `ATTACHMENT_MAX_PER_SUBMIT`      | `10`                              | 单次提交附件数量上限，范围 1–50                                   |
| `ATTACHMENT_MAX_PER_RECORD`      | `50`                              | 单条记录累计附件上限，范围 1–200                                  |
| `ATTACHMENT_TEMP_TTL_HOURS`      | `24`                              | 未绑定临时附件保留小时数，范围 1–168                              |
| `STORAGE_PROBE_TIMEOUT_MS`       | `10000`                           | 储存桶连接测试超时，范围 1–60 秒                                  |

`ROOT_EMAIL`、`ROOT_INITIAL_PASSWORD` 只由 `seed:root` 一次性使用，不进入常驻服务配置。

## 目录与扩展约定

```text
apps/server/
├── src/
│   ├── entrypoints/              # HTTP 和迁移命令入口
│   ├── bootstrap/                # HTTP 组装、迁移 schema 聚合
│   ├── modules/                  # identity、projects、requirements、bugs、code 等业务模块
│   └── platform/
│       ├── config/               # 环境变量校验
│       ├── database/             # 连接池、命名空间、迁移执行
│       └── http/                 # 公共错误响应
├── drizzle/                      # SQL 迁移及元数据
├── scripts/                      # 本地配置与离线契约导出
├── test/                         # 配置、HTTP、真实数据库测试
├── .env.example
├── drizzle.config.ts
└── package.json
```

新增业务时，建立 `modules/<业务名>/`。路由文件负责 HTTP 输入输出，schema 文件定义请求和响应。出现业务规则时添加 service，出现持久化操作时添加 repository；service 通过参数接收依赖，避免直接依赖 HTTP request/reply。

后端是 Node ESM 工程：`package.json` 声明 `"type": "module"`，tsconfig 使用 `module` 与 `moduleResolution: NodeNext`。相对导入统一写 `.ts` 扩展名（与源文件一致）；共享 Node tsconfig 开启 `rewriteRelativeImportExtensions`，`tsc` 输出到 `dist/` 时自动改写为 `.js`，本地开发由 `tsx` 解析源码。这是 NodeNext ESM 的标准做法，不是模块化配置缺失或写法错误。

后端按业务模块组织，模块用于组织代码而不是强制封装：跨模块可以直接导入对方的 service、read、repository 或表定义，也可以跨模块 SQL join。同一张表的写入逻辑优先留在数据所属模块，靠代码评审维持；不再强制 `public.ts` 门面或依赖检查。

将模块作为 Fastify 插件注册到 `bootstrap/create-http-app.ts`，统一使用 `/api/v1` 前缀。用 TypeBox 定义请求和响应 schema，插件使用 `FastifyPluginAsyncTypebox` 保留类型推导。需要拒绝额外字段时，在对象 schema 中指定 `additionalProperties: false`。

自研接口只使用 GET 与 POST，统一返回 HTTP 200 与响应信封：

- 成功：`{ success: true, code: "OK", message, requestId, data }`
- 失败：`{ success: false, code, message, requestId, data? }`

业务失败使用错误码表达，不用 4xx/5xx；`requestId` 与响应头 `x-request-id` 一致，用于关联日志。未知 API 路径同样返回 HTTP 200 + `NOT_FOUND` 信封；未处理异常返回 500 失败信封，内部细节只进入日志。相关行为由 [test/http/app.test.ts](test/http/app.test.ts) 验证。

根目录 `pnpm api:generate` 从已注册路由导出 OpenAPI 并生成 Web、CLI 的共享客户端，无需数据库在线。后续业务表在所属模块定义，并从 `bootstrap/database-schema.ts` 汇总；跨模块直接导入目标模块实现，循环依赖、应用越界和 platform 反向依赖由根目录 `pnpm check:boundaries` 检查。Worker、适配器和业务 service 在出现实际使用者时添加。

数据库配置与迁移见[数据库说明](../../docs/architecture/database.md)。认证和异步任务的接入条件见[选型规划](../../docs/architecture/server-foundation.md)。

## V0.1 已实现模块与路由

`POST /api/v1/requirements/:requirementId/update` 与 `POST /api/v1/bugs/:bugId/update` 使用版本号保存局部字段。标题、派工和协作人可按权限维护。需求提测后以及 Bug 提交回归后，需通过相应流程动作回到可改范围的阶段再修订正文、复现或附件清单。当前回归负责人的调整从撤回回归开始。

详情返回的 `plan` 保存本事项的规划节点和待办。同一更新接口可传入完整 `plan` 替换当前规划。节点和待办的 `startsOn`、`endsOn` 均允许设为 `null`。规划写入增加事项版本并记录操作历史。

`POST /api/v1/projects/:projectId/code-references` 带 `replaceReferenceId` 时，核对新目标后在同一事务替换同一事项的引用。需求与 Bug 的解除关联及代码引用移除沿用现有操作接口，原因写入操作记录。

- 身份：`/api/v1/auth/*`（Better Auth 协议端点，保留库状态码，显式例外）、`/me/teams`、`/platform/teams`、团队邀请/成员接口。
- 项目：`/teams/:teamId/projects`、`/projects/:projectId`、`/update`、`/stats`。
- 需求：项目需求列表/创建、详情/更新、评论/活动、提测/测试/通过/取消/恢复等动作、提测历史。
- Bug：项目 Bug 列表/创建、详情/更新、修复/回归/关闭/重开、需求关联、评论/活动。
- 需求与 Bug 评论响应包含作者标识 `authorUserId`、展示名 `authorName` 和可选头像 `authorImage`。列表按页批量查询作者。团队成员、项目负责人及事项详情中的人员引用使用可选的 `image` 字段。头像为平台保存的 JPEG 缩略图，沿用对应接口的访问权限。
- 集成：`/git-providers`、团队 Git 连接、检查/同步/撤权、授权回调；Gitea Token 与 GitHub App 凭据加密保存。
- 代码：项目仓库关联/移除、可关联仓库、代码引用创建/刷新/移除。
- 所有自研业务接口只注册 GET/POST，返回 HTTP 200 信封；未知 API 路径也返回 200 + `NOT_FOUND`。未处理异常才返回 500。
- root 初始化：`pnpm --dir apps/server seed:root`；本地 SMTP 可使用 Mailpit（`SMTP_URL=smtp://127.0.0.1:1025`）。

## 项目代码目录

`GET /api/v1/projects/:projectId/repositories/:repositoryId/tree` 提供可选的 `branch` 和 `path`。传入 `path=` 读取根目录，传入仓库相对路径只返回该目录的直接子项。条目的 `path` 仍然是相对于仓库根目录的路径。省略 `path` 保留递归清单行为，供 CLI 和流水线使用。

Web 按项目、仓库、分支和路径缓存已读取的目录与文件正文。查询结果在 60 秒内可直接复用，离开后未被使用的条目按客户端默认策略在 5 分钟后回收。

## 项目首页晴雨表

`GET /api/v1/teams/:teamId/project-activity` 按团队权限和项目筛选读取 PostgreSQL。事项活动读取平台活动表；提交和 PR 读取按仓库、UTC 日期、来源预聚合的日统计。同一仓库在热力图只计一次，项目卡片分别显示各项目关联仓库的未关闭 PR 数。

部署时先执行 `pnpm --dir apps/server db:migrate`，并运行现有 Worker（本地用 `pnpm --dir apps/server dev:worker`）。Worker 复用 Git 连接凭据，每轮领取一个到期仓库，正常情况下每仓库约 5 分钟轮询一次。保留最近 371 个 UTC 日期。提交从默认分支回填，分支头不变时跳过更新，快进时追加，分支切换或无法验证快进时重建对应仓库。PR 按创建日计数，按更新时间增量核对，每天重新核对一次，未关闭计数包含窗口之外的 PR。

未完成回填、来源不可用、请求窗口早于缓存范围或超过 15 分钟未核对时，相应 `sourceStatus` 为 `unknown`。项目关联的任一仓库 PR 来源不可用时，项目未关闭 PR 数以 `null` 表示。单仓同步使用 60 秒预算，每次分页扫描最多 80 页，超限时按来源失败处理。仓库解绑、Git 连接失效或凭据撤销后，接口按当前关系和权限排除对应统计。

## V0.2 实现说明（进行中）

- 新增 `delivery` 模块：构建记录、产物引用、构建事项关联与更正历史；路由 `POST /api/v1/projects/:projectId/builds`、`GET /api/v1/builds/:buildId` 等，全部只使用 GET/POST 与统一信封。
- `projects` 增加服务与环境目录表定义；`configuration` 复用加密凭据能力；团队表增加图标标识/说明/版本字段；活动表扩展 V0.2 对象类型。
- V0.2 未新增环境变量：通用凭据复用既有加密密钥；产物只保存引用，不配置对象存储；不建本地仓库克隆/缓存。
- 迁移从 0014 起；交付上报按「项目＋来源＋构建标识」幂等，更正保留历史，不改变需求/Bug/提测状态。

## API Token 与 CLI（2026-11-10）

服务端新增 `personal_access_token` 表与 `/api/v1/me`、`/api/v1/me/tokens*` 接口；业务接口同时接受现有 Better Auth Cookie 会话和 `Authorization: Bearer devops_pat_...`。Token 只保存 SHA-256 摘要、明文仅在创建响应返回一次，管理接口只允许登录会话。CLI 使用说明见 [apps/cli/README.md](../cli/README.md)。

## 个人资料

`POST /api/v1/auth/update-user` 使用登录 Cookie 更新当前用户的 `name` 和 `image`，省略字段表示保留原值。`image` 接受 160×160 像素的 JPEG data URL，解码后最大 32 KiB，传 `null` 可移除。保存前服务端重新编码图片以去除元数据，缩略图存入账号的 `image` 字段。`GET /api/v1/auth/get-session` 返回当前头像。两个端点均沿用 Better Auth 状态码，图片不合格时返回 HTTP 400。

## knowledge 模块（团队 Skills）

`src/modules/knowledge/` 提供团队技能库，路由挂载在 `/api/v1`。

- 技能：`GET/POST /teams/:teamId/skills`、`GET /skills/:skillId`、`POST /skills/:skillId/update|enable|disable`、版本与活动列表。

路由使用 GET/POST 和统一信封，复用既有业务错误码。服务层校验团队归属和写权限，写入技能时在同一事务追加 `skill` 活动。历史模板和项目选用数据保留在既有数据库表中，相关 API 已下线。

## V0.4a pipeline 模块（内置流水线执行器）

`src/modules/pipeline/` 提供内置流水线控制面、调度 Worker 与 Agent 协议端点；工作流语法见 `specs/005-v04a-pipeline-runner/contracts/workflow-yaml.md`，Agent 内部协议见 `contracts/agent-protocol.md`。

- 数据表：`pipeline_run`、`pipeline_run_step`、`pipeline_run_log`、`pipeline_artifact`、`pipeline_node`、`pipeline_node_token`、`pipeline_lease`（迁移 0020 建表、0021 补中文注释与活动目标约束）。日志/产物正文存本地目录，数据库只存元数据。
- 进程：API 进程负责控制面与 Agent 协议端点；独立 Worker（`pnpm --dir apps/server dev:worker` / `node dist/entrypoints/worker.js`）负责 `FOR UPDATE SKIP LOCKED` 调度、能力匹配、租约过期、节点离线、运行超时与取消兜底。
- 触发固定提交 SHA、工作流快照与运行计划；租约以节点令牌 + `X-Lease-Token` 作用域，数据库只保存令牌 SHA-256 哈希；Git 短期凭据与运行时 secrets 只在 Agent 领取租约的响应中物化，不写入运行记录、日志与视图。

### 平台接口（均走 /api/v1、GET/POST、统一信封）

| 方法与路径                                           | 权限                     | 说明                                                             |
| ---------------------------------------------------- | ------------------------ | ---------------------------------------------------------------- |
| `GET /projects/:projectId/pipeline-workflows`        | 项目可见                 | 列出 `.devops/workflows/` 工作流与解析状态、最近运行             |
| `GET /projects/:projectId/pipeline-workflows/detail` | 项目可见                 | 工作流详情、YAML 内容、内容哈希与计划摘要                        |
| `POST /projects/:projectId/pipeline-runs`            | 管理员/开发者            | 手动触发运行，幂等键重复返回同一运行                             |
| `GET /projects/:projectId/pipeline-runs`             | 项目可见                 | 运行列表，按 workflowPath/status/from/to 筛选并分页              |
| `GET /pipeline-runs/:runId`                          | 项目可见                 | 运行详情：输入摘要、发起人、节点摘要、步骤、产物与日志元数据     |
| `POST /pipeline-runs/:runId/cancel`                  | 管理员/开发者            | 取消运行，返回最新详情                                           |
| `GET /pipeline-runs/:runId/logs`                     | 项目可见                 | 按 stepIndex/afterSeq/limit 读取日志分片                         |
| `GET /pipeline-runs/:runId/artifacts`                | 项目可见                 | 运行产物列表（含受鉴权 downloadUrl）                             |
| `GET /pipeline-artifacts/:artifactId/download`       | 项目可见                 | 产物二进制下载（文件传输显式例外，见下）                         |
| `GET/POST /teams/:teamId/pipeline-nodes`             | 团队管理员               | 节点列表、创建节点并返回一次性注册令牌                           |
| `POST /pipeline-nodes/:nodeId/drain`                 | 团队管理员               | 排空节点，不再分配新运行                                         |
| `POST /pipeline-nodes/:nodeId/disable`               | 团队管理员               | 停用节点并撤销 Agent 令牌                                        |
| `POST /pipeline-nodes/:nodeId/tokens/rotate`         | 团队管理员               | 轮换 Agent 令牌，旧令牌立即失效                                  |
| `POST /projects/:projectId/attachments`              | 管理员/开发者            | 原始流上传临时附件；按 Content-Length 自行计量并跳过全局幂等钩子 |
| `GET /attachments/policy`                            | 登录用户                 | 附件大小、单次/单记录数量与临时保留期策略                        |
| `GET /attachments/:attachmentId/download`            | 项目可见                 | 附件二进制下载（文件传输第二条例外，见下）                       |
| `POST /attachments/:attachmentId/remove`             | 上传者/管理员/项目负责人 | 删除附件；事务内置 removed 或删除临时记录，对象在提交后删除      |

角色口径：浏览者可查看工作流/运行/日志/产物，不可触发或取消；开发者可触发与取消；节点管理与令牌轮换仅团队管理员。所有接口逐层校验登录身份、团队成员、项目归属与角色。

工作流来源口径：P1 工作流列表以项目**第一个已关联仓库**为来源（返回单一 `commitSha`）；触发与详情会在项目全部已关联仓库中按路径查找，找到后固定该仓库的提交与快照。多仓库同时展示与目录配置后置到 P2。

### Agent 内部协议端点

`/api/v1/agent/*`（register、heartbeat、lease、lease 重约、步骤状态、日志、产物上传、完成）只服务自托管执行节点，使用 `Authorization: Bearer <agentToken>` 与租约作用域头 `X-Lease-Token`；节点注册以注册令牌绑定的节点为准，请求中的 `name` 仅作为 Agent 自述信息，不参与校验。该组端点**不进入公开 OpenAPI 与生成客户端**，契约以 `specs/005-v04a-pipeline-runner/contracts/agent-protocol.md` 为准；协议类型由 `packages/pipeline-protocol` 统一导出。

租约领取幂等口径（P1 已知限制）：数据库只保存 `lease_token_hash`，无法重放同一明文令牌，因此**节点已有活动租约时重复领取返回 `data: null`**；Agent 首次领取响应丢失时应依赖租约过期由 Worker 收口为 `interrupted`，不重复获取已分配运行。可重放的幂等租约令牌方案（如加密暂存明文或一次性重放窗口）留待 P2 评估。契约文档 `contracts/agent-protocol.md` 由 Lead 同步该偏差。

节点 os/arch 历史数据：D8 修复前注册的旧节点会保留 `unknown`，需要重新注册（或重建节点后用新注册令牌注册）才会更新为 Agent 实际上报值；新注册节点会持久化请求中的 `os`/`arch`。

节点状态与注册口径：管理员停用节点时会撤销其全部令牌，因此停用后再次注册返回 `AGENT_REGISTRATION_TOKEN_INVALID`；已注册节点在停用后调用心跳返回 `AGENT_NODE_DISABLED`。日志分片与产物的 HTTP 层只保留一个宽松的协议上限（日志单分片 1 MB、产物上限 + 1 MB 缓冲），超过平台业务上限（`PIPELINE_LOG_CHUNK_MAX_BYTES` / `PIPELINE_ARTIFACT_MAX_BYTES`）时由服务层返回 `AGENT_LOG_LIMIT_EXCEEDED` / `AGENT_ARTIFACT_LIMIT_EXCEEDED`，避免被 schema 提前拦成 `VALIDATION_ERROR`。

### 错误码登记（集中定义于 platform/http/error-codes.ts）

- 工作流/触发：`PIPELINE_WORKFLOW_NOT_FOUND`、`PIPELINE_WORKFLOW_PARSE_ERROR`、`PIPELINE_WORKFLOW_SCHEMA_ERROR`、`PIPELINE_WORKFLOW_UNSUPPORTED`、`PIPELINE_WORKFLOW_SECRET_UNSAFE`、`PIPELINE_REPOSITORY_UNAVAILABLE`、`PIPELINE_COMMIT_NOT_FOUND`。
- 运行与产物：`PIPELINE_RUN_NOT_FOUND`、`PIPELINE_STATE_CONFLICT`、`PIPELINE_LOG_NOT_FOUND`、`PIPELINE_ARTIFACT_NOT_FOUND`、`PIPELINE_ARTIFACT_CONFLICT`、`PIPELINE_STORAGE_ERROR`、`PIPELINE_LEASE_EXPIRED`、`PIPELINE_NODE_OFFLINE`、`PIPELINE_NODE_NOT_FOUND`、`PIPELINE_NODE_NAME_CONFLICT`。
- 凭据：`PIPELINE_GIT_CREDENTIAL_ERROR`、`PIPELINE_SECRET_UNAVAILABLE`；错误消息只说明不可用原因，不返回令牌、Git 凭据或连接串。
- Agent 协议：`AGENT_TOKEN_INVALID`、`AGENT_REGISTRATION_TOKEN_INVALID`、`AGENT_NODE_DISABLED`、`AGENT_LEASE_EXPIRED`、`AGENT_LEASE_INVALID`、`AGENT_STEP_STATE_CONFLICT`、`AGENT_LOG_SEQ_CONFLICT`、`AGENT_LOG_LIMIT_EXCEEDED`、`AGENT_ARTIFACT_LIMIT_EXCEEDED`、`AGENT_VERSION_UNSUPPORTED`（`packages/pipeline-protocol` 同时导出 `AGENT_ERROR_CODES` 供 Agent 复用）。
- 附件：`ATTACHMENT_NOT_FOUND`、`ATTACHMENT_INVALID`、`ATTACHMENT_LIMIT_EXCEEDED`、`ATTACHMENT_STATE_CONFLICT`、`ATTACHMENT_STORAGE_UNAVAILABLE`；错误消息不返回对象键、桶标识与桶凭据。绑定数量/保留期等业务失败由需求与缺陷接口透传同一批错误码。
- 储存桶：`STORAGE_BUCKET_NOT_FOUND`、`STORAGE_BUCKET_NAME_CONFLICT`、`STORAGE_BUCKET_IN_USE`、`STORAGE_BUCKET_NOT_WRITABLE`、`STORAGE_BUCKET_PROBE_FAILED`、`STORAGE_BUCKET_BUILTIN_PROTECTED`；引用中的桶被删除或停用时消息与 `data.attachmentCount` 给出引用数量，消息不返回凭据、密文、Access Key 或服务端堆栈。

### 显式例外与安全约束

- **文件传输显式例外**：`GET /pipeline-artifacts/:artifactId/download` 成功时返回 `application/octet-stream` 流，不套信封，响应头带 `X-Content-SHA256`；失败仍返回 HTTP 200 + 统一 JSON 信封。该例外与 Better Auth 协议端点例外分开登记。
- **附件下载显式例外（第二条例外）**：`GET /attachments/:attachmentId/download` 成功时返回 `application/octet-stream` 流 + `Content-Disposition: attachment; filename*=UTF-8''…`、`Content-Length` 与 `X-Content-SHA256`，不套信封；失败（非项目成员、附件不存在、储存桶不可用）仍返回 HTTP 200 + 统一 JSON 信封。该例外与流水线产物下载例外分别登记；附件按记录固定的 `bucket_id`/`storage_key` 读取，不随默认桶切换变化，临时附件超期清理与 removed 重试由 worker 每 10 分钟执行。
- 服务端不执行用户代码；API 进程只做控制面，容器执行在自托管节点。日志与错误在服务端和 Agent 侧各脱敏一次；节点令牌、Git 凭据、运行时密钥只保存哈希/密文，明文本只在必要时短暂出现在内存与一次性响应中。
- 日志/产物大小与分片数量有上限；租约过期不自动改派，运行收口为 `interrupted` 并保留已有日志与产物。

## 储存桶管理与 S3 兼容接入（平台管理员）

`src/modules/storage/` 提供平台级储存桶配置、S3 兼容适配器与配置变更审计；附件功能只依赖 `StorageAdapter`（`put`/`get`/`remove`/`probe`），本地桶与 S3 兼容桶共用同一套附件用例，新增桶类型不修改需求与缺陷模块。平台管理员接口挂载在 `/api/v1`，只使用 GET/POST 与统一信封，全部由 `requirePlatformAdmin` 兜底。

| 方法与路径                                             | 权限       | 说明                                                                                |
| ------------------------------------------------------ | ---------- | ----------------------------------------------------------------------------------- |
| `GET /platform/storage-buckets`                        | 平台管理员 | 列表按内置桶 → 默认桶 → 创建时间倒序；只返回 Access Key 掩码与最近探测结论          |
| `POST /platform/storage-buckets`                       | 平台管理员 | 创建 S3 兼容桶；首期 `kind` 只允许 `s3`；`setAsDefault=true` 时先验证可读写         |
| `POST /platform/storage-buckets/:bucketId/update`      | 平台管理员 | 更新配置；`version` 乐观锁，Secret 省略即保留；内置桶只允许改名                     |
| `POST /platform/storage-buckets/:bucketId/test`        | 平台管理员 | 写探针 → 读回校验 → 删除；归因 `read_write`/`read_only`/`unreachable`/`auth_failed` |
| `POST /platform/storage-buckets/:bucketId/set-default` | 平台管理员 | 要求启用且最近探测为 `read_write`；同一时刻只允许一个默认桶                         |
| `POST /platform/storage-buckets/:bucketId/remove`      | 平台管理员 | 拒绝内置桶、当前默认桶与仍被附件引用的桶；删除后审计事件保留                        |

约束：

- 凭据只保存 AES-256-GCM 密文（复用 `GIT_CREDENTIAL_ENCRYPTION_KEY`）；未配置加密密钥时创建或轮换凭据返回 `STORAGE_BUCKET_NOT_WRITABLE`，本地桶不受影响。
- 响应、日志与审计均不出现明文凭据；`storage_bucket_event.changes` 中凭据字段记为 `"***"`，只记录字段名与掩码。列表与详情不含 `credential_*` 列。
- S3 适配器固定 `forcePathStyle: true` 并允许自定义 `endpoint`/`region`；探测通过 `NodeHttpHandler` 设置 `connectionTimeout`/`requestTimeout`（`STORAGE_PROBE_TIMEOUT_MS`），普通对象读写只设置连接超时，避免固定请求超时误杀大文件传输。
- 每次写操作（创建、更新、测试、设默认、删除）在同一事务内追加 `storage_bucket_event`；平台级事件没有团队归属，不进入团队 `activity` 流。附件记录固化上传时的 `bucket_id`，默认桶切换不影响历史附件下载。

## V0.4b tools 与 operations 模块（2026-11-11）

- `tools` 路由：
  - `GET /api/v1/projects/{projectId}/tools/capabilities`
  - `GET|POST /api/v1/projects/{projectId}/tools/grants`、`POST /api/v1/projects/{projectId}/tools/grants/{grantId}/revoke`
  - `POST|GET /api/v1/projects/{projectId}/tools/code-changes`、`GET /api/v1/tools/code-changes/{codeChangeId}`、`GET /api/v1/tools/code-changes/{codeChangeId}/diff`、`POST /api/v1/tools/code-changes/{codeChangeId}/cancel`、`POST /api/v1/tools/code-changes/{codeChangeId}/pull-requests`
  - `POST /api/v1/projects/{projectId}/tools/remote-issues`、`POST /api/v1/projects/{projectId}/tools/comments`
- `operations` 路由：
  - `POST|GET /api/v1/projects/{projectId}/change-plans`、`GET /api/v1/teams/{teamId}/change-plans`、`GET /api/v1/change-plans/{planId}`
  - `POST /api/v1/change-plans/{planId}/update|approve|execute|verify|cancel|retry`
  - `GET /api/v1/change-plans/{planId}/executions|events`
- 写能力默认关闭，按“用户 × 项目 × 能力”授权；服务端逐次校验，不因角色或项目成员身份自动放行。
- 放行绑定计划修订与内容快照；计划修改后旧放行失效；同一服务 + 环境只允许一条活动计划。
- 验证读取节点产出的 `change-verification` 产物，健康与实际版本一致才完成计划并更新运行版本。
- 新增配置：`CODE_CHANGE_PATCH_MAX_BYTES`、`CODE_CHANGE_DIFF_RESPONSE_MAX_BYTES`、`CODE_CHANGE_TIMEOUT_SECONDS`、`DEPLOY_VERIFY_TIMEOUT_SECONDS`、`CHANGE_PLAN_LIST_MAX_PAGE_SIZE`，说明见 `.env.example`。
- 新增错误码：`TOOL_CAPABILITY_NOT_GRANTED`、`TOOL_INVOCATION_CONFLICT`、`CODE_CHANGE_*`、`PULL_REQUEST_CONFLICT`、`REMOTE_WRITE_CONFLICT`、`CHANGE_PLAN_*`、`SELF_APPROVAL_FORBIDDEN`、`CHANGE_EXECUTION_*`、`CHANGE_VERIFICATION_MISMATCH`。
- 未验证：真实 GitHub 写权限、真实 Gitea 写能力现场验收、非本机执行节点、生产部署与外部执行系统连接器。

## 附件存储与部署（V0.5）

- 默认使用本地存储桶，根目录由 `ATTACHMENT_STORAGE_DIR` 指定（默认 `./attachment-data`）。该目录必须可写、与数据库备份一同保留，并在部署层做持久化挂载或备份策略；当前 `deploy/compose.yaml` 只包含 PostgreSQL，应用与存储目录按实际部署方式挂载。
- 平台 root 用户可在「平台管理 → 储存桶」（`/platform`）接入 S3 兼容桶并设为默认；桶凭据使用 `GIT_CREDENTIAL_ENCRYPTION_KEY` 加密保存，界面与接口只返回掩码，日志不记录凭据。
- 附件下载是继流水线产物之后的第二条例外：成功返回二进制流并带 `X-Content-SHA256`，失败返回 HTTP 200 统一信封。
- 未绑定临时附件保留 24 小时后由 Worker 每 10 分钟清理；已绑定附件的对象删除在事务提交后执行，失败由清理任务重试。

## 项目回收站

- 同团队允许项目同名，各接口和关联继续通过项目 ID 定位。
- 团队管理员或当前项目的开发者负责人可用登录会话调用 `POST /api/v1/projects/:projectId/remove`，提交项目版本和本人密码。仍有未收口执行时，接口返回 `PRECONDITION_FAILED` 和阻塞说明。
- 团队管理员可用 `GET /api/v1/teams/:teamId/project-recycle-bin` 分页查询回收站，或向 `POST /api/v1/projects/:projectId/restore` 提交版本，按原名称和标识恢复。普通项目和子资源接口隐藏回收站项目。
- `POST /api/v1/projects/:projectId/cleanup-files` 由团队管理员提交项目版本和本人密码，排队清理平台托管附件和流水线产物。任务结束后可恢复项目，清理过的文件不可用，数据库元数据、日志和审计记录保留。两个密码操作共用每账号五分钟十次的验证配额。
- 部署时先执行数据库迁移，然后统一更新 API 与 Worker，最后发布 Web。Worker 重启后会接管租约过期的任务，失败任务可在回收站手动重试。

## Bot 执行服务

从仓库根目录运行 `pnpm --dir apps/server dev:bot-worker` 启动执行服务，编译后也可以运行 `pnpm --dir apps/server start:bot-worker`。执行服务和 HTTP 进程共享 PostgreSQL。调度 Worker 收口过期的运行租约。

| 业务错误码                         | 含义                               |
| ---------------------------------- | ---------------------------------- |
| `BOT_NOT_FOUND`                    | Bot 不存在或不可见                 |
| `BOT_UNAVAILABLE`                  | Bot 已停用、未绑定模型或模型不可用 |
| `BOT_MODEL_CONNECTION_UNAVAILABLE` | 模型连接已停用或登录失败           |
| `BOT_MODEL_NOT_IN_CATALOG`         | 所选模型不在模型目录中             |
| `BOT_CONVERSATION_NOT_FOUND`       | 会话不存在或用户不可见             |
| `BOT_MENTION_AMBIGUOUS`            | 会话消息同时指定多个 Bot           |
| `BOT_NO_RECEIVER`                  | 会话没有可用的承接 Bot             |
| `BOT_TASK_STATE_CONFLICT`          | 任务状态拒绝该操作                 |
| `BOT_RUN_STATE_CONFLICT`           | 运行状态拒绝该操作                 |
| `BOT_API_FORBIDDEN`                | 委托调用命中平台接口排除规则       |
| `BOT_MEMORY_LIMIT`                 | 记忆条数或常驻长度达到上限         |
| `BOT_MEMORY_SECRET`                | 内容包含疑似凭据                   |
| `BOT_LOGIN_FAILED`                 | 订阅登录失败、超时或取消           |
