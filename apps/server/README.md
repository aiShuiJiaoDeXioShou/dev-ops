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
| `GITHUB_AUTH_MODE`               | `cli`                             | GitHub 数据源：stg 用 `cli`（已登录 `gh`），生产用 `app`          |
| `GITHUB_ALLOWED_REPOS`           | 空                                | `cli` 模式仓库 allowlist，逗号分隔 `owner/repo`                   |
| `GITHUB_APP_ID`                  | 未设置                            | `app` 模式 GitHub App ID                                          |
| `GITHUB_APP_PRIVATE_KEY_PATH`    | 未设置                            | `app` 模式 App 私钥文件路径                                       |
| `GITHUB_APP_SLUG`                | 未设置                            | `app` 模式安装入口 slug                                           |

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

- 身份：`/api/v1/auth/*`（Better Auth 协议端点，保留库状态码，显式例外）、`/me/teams`、`/platform/teams`、团队邀请/成员接口。
- 项目：`/teams/:teamId/projects`、`/projects/:projectId`、`/update`、`/stats`。
- 需求：项目需求列表/创建、详情/更新、评论/活动、提测/测试/通过/取消/恢复等动作、提测历史。
- Bug：项目 Bug 列表/创建、详情/更新、修复/回归/关闭/重开、需求关联、评论/活动。
- 集成：`/git-providers`、团队 Git 连接、检查/同步/撤权、授权回调；Gitea Token 与 GitHub App 凭据加密保存。
- 代码：项目仓库关联/移除、可关联仓库、代码引用创建/刷新/移除。
- 所有自研业务接口只注册 GET/POST，返回 HTTP 200 信封；未知 API 路径也返回 200 + `NOT_FOUND`。未处理异常才返回 500。
- root 初始化：`pnpm --dir apps/server seed:root`；本地 SMTP 可使用 Mailpit（`SMTP_URL=smtp://127.0.0.1:1025`）。
