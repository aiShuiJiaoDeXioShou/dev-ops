# TypeScript 后端

[src/app.ts](src/app.ts) 组装 Fastify 应用，[src/server.ts](src/server.ts) 启动 HTTP 服务并处理退出信号。应用通过 `app.db` 提供 Drizzle 数据访问，包含存活检查、数据库就绪检查和开发环境接口文档。业务模块按需添加到 `src/modules/`。

## 开发与验证

在仓库根目录运行 `nvm use`，使用 [.nvmrc](.nvmrc) 指定的 Node 版本。pnpm 版本由 [package.json](package.json) 固定。

```bash
pnpm --dir server install --frozen-lockfile
pnpm --dir server db:setup
pnpm --dir server db:up
pnpm --dir server db:migrate
pnpm --dir server dev
```

`db:setup` 生成包含随机密码的本地配置，已有配置不会被覆盖。应用要求提供 `DATABASE_URL`，配置项见 [.env.example](.env.example)；系统环境变量优先。启动脚本读取 `server/.env`，配置校验失败会阻止启动。迁移账号单独保存在 `server/.env.database`，应用启动不加载它。完整操作见[数据库说明](docs/database.md)。

| 命令（在仓库根目录执行） | 用途 | 输出或行为 |
| --- | --- | --- |
| `pnpm --dir server dev` | 本地开发 | 监听源码变化并重启 |
| `pnpm --dir server check` | 提交前检查 | 类型检查、Oxlint、接口与配置测试 |
| `pnpm --dir server build` | 编译服务 | 输出 ESM JavaScript 到 `dist/` |
| `pnpm --dir server start` | 运行编译产物 | 需先执行 build |
| `pnpm --dir server typecheck` | 单独检查类型 | 包含源码和测试 |
| `pnpm --dir server lint` | 单独检查代码规范 | 使用 `.oxlintrc.json` |
| `pnpm --dir server test` | 单独运行测试 | 不依赖数据库的接口与配置测试 |
| `pnpm --dir server test:db` | 数据库集成测试 | 需要本地 PostgreSQL，自动创建并删除独立测试库 |

部署时将 `NODE_ENV` 设置为 `production`。容器中需要将 `HOST` 设置为 `0.0.0.0`；默认地址只监听本机。

## 接口与前端联调

默认监听 `http://127.0.0.1:3001`，以下路径由 [app.ts](src/app.ts) 和[健康检查模块](src/modules/health/health.routes.ts) 注册。

| 方法与路径 | 用途 | 返回内容 |
| --- | --- | --- |
| `GET /api/v1/health` | 进程存活检查 | `{"status":"ok"}`，不检查数据库 |
| `GET /api/v1/ready` | 数据库就绪检查 | 成功返回 `{"status":"ok","database":"ok"}`，失败返回 503 |
| `GET /docs/` | 开发环境交互文档 | Swagger UI |
| `GET /docs/json` | 导出接口契约 | OpenAPI JSON |

前端 [Vite 配置](../apps/web/vite.config.ts) 将 `/api` 请求代理到默认后端地址。启动前后端后，页面可以直接调用 `fetch('/api/v1/health')`。修改后端端口时，同步修改代理地址。

该代理仅用于 Vite 开发服务器。部署时需要在网关配置同源 `/api` 转发。接口文档通过后端地址访问。

## 环境变量

配置定义位于 [src/config/env.ts](src/config/env.ts)，非法值会阻止服务启动。端口接受范围为 1 到 65535 的整数。

| 变量 | 默认值 | 用途 |
| --- | --- | --- |
| `NODE_ENV` | `development` | 可选 `development`、`test`、`production` |
| `HOST` | `127.0.0.1` | HTTP 监听地址 |
| `PORT` | `3001` | HTTP 监听端口 |
| `LOG_LEVEL` | `info` | 可选 `fatal`、`error`、`warn`、`info`、`debug`、`trace`、`silent` |
| `DOCS_ENABLED` | 生产环境 `false`，其他环境 `true` | 显式设置 `true` 或 `false` 控制接口文档 |
| `DATABASE_URL` | 必填 | 应用账号的 PostgreSQL URL，必须包含主机和库名 |
| `DB_POOL_MAX` | `10` | 每个后端进程的连接池上限，范围 1-100 |
| `DB_CONNECT_TIMEOUT_MS` | `5000` | 获取连接超时，范围 1-60000 毫秒 |
| `DB_IDLE_TIMEOUT_MS` | `30000` | 空闲连接回收时间，范围 1-600000 毫秒 |
| `DB_STATEMENT_TIMEOUT_MS` | `10000` | 数据库语句超时，范围 1-300000 毫秒 |
| `DB_LOCK_TIMEOUT_MS` | `3000` | 数据库锁等待超时，范围 1-60000 毫秒 |
| `DB_IDLE_TRANSACTION_TIMEOUT_MS` | `30000` | 空闲事务会话超时，范围 1-600000 毫秒 |

## 目录与扩展约定

```text
server/
├── src/
│   ├── app.ts                  # 组装应用，供测试直接调用
│   ├── server.ts               # 监听端口、处理 SIGINT/SIGTERM
│   ├── config/env.ts           # 环境变量校验
│   ├── db/                     # Drizzle schema、连接池与迁移入口
│   ├── modules/health/         # 路由和 schema 示例
│   └── shared/errors.ts       # 错误响应与错误处理
├── drizzle/                    # SQL 迁移及快照
├── drizzle.config.ts           # 迁移生成配置
├── docker/postgres/init.sql     # 本地数据库账号初始化
├── scripts/setup-db.ts         # 本地随机凭据生成
├── test/                       # 接口、配置与数据库集成测试
├── docs/architecture.md        # 技术选型和后续建议
├── .env.example
├── tsconfig.json
└── tsconfig.build.json
```

新增业务时，建立 `modules/<业务名>/`。路由文件负责 HTTP 输入输出，schema 文件定义请求和响应。出现业务规则时添加 service，出现持久化操作时添加 repository；service 通过参数接收依赖，避免直接依赖 HTTP request/reply。

将模块作为 Fastify 插件注册到 `app.ts`，统一使用 `/api/v1` 前缀。用 TypeBox 定义请求和响应 schema，插件使用 `FastifyPluginAsyncTypebox` 保留类型推导。需要拒绝额外字段时，在对象 schema 中指定 `additionalProperties: false`。

成功响应直接返回接口定义的数据；错误响应使用 `{ code, message, requestId }`。服务端错误的内部消息只进入日志，客户端收到通用消息；响应头 `x-request-id` 可用于关联请求日志。相关行为由 [test/app.test.ts](test/app.test.ts) 验证。

数据库配置与迁移见[数据库说明](docs/database.md)。认证和异步任务的接入条件见[选型规划](docs/architecture.md)。
