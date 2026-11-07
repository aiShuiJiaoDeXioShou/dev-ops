# PostgreSQL 与 Drizzle

后端使用 PostgreSQL 18、Drizzle ORM 和 `pg` 连接池。[连接实现](../src/db/client.ts)负责超时、UTC 会话和连接回收，[schema 定义](../src/db/schema.ts)统一导出 `app` schema，[迁移入口](../src/db/migrate.ts)执行版本化 SQL。当前仅初始化基础 schema 与权限，业务表在具体功能开发时增加。

## 本地初始化

需要启动 Docker，并使用根目录 `.nvmrc` 指定的 Node.js 版本。以下命令均在项目根目录执行：

```bash
pnpm --dir server install --frozen-lockfile
pnpm --dir server db:setup
pnpm --dir server db:up
pnpm --dir server db:migrate
pnpm --dir server dev
```

`db:setup` 生成 `server/.env` 和 `server/.env.database`，分别保存应用连接配置和本地数据库管理配置。密码独立随机生成，文件权限为仅当前用户可读写；再次执行保留原文件。如果只有一份文件存在，命令会停止，需按示例补齐配置，避免意外重置凭据。

[Compose 配置](../../compose.yaml)使用 `postgres:18-alpine`，绑定 `127.0.0.1:5433`，数据库名为 `dev_ops`，数据存入项目独立命名卷。修改端口时，同时修改 `.env.database` 的 `POSTGRES_PORT`、`MIGRATION_DATABASE_URL` 和 `.env` 的 `DATABASE_URL`。PostgreSQL 18 的卷挂载在 `/var/lib/postgresql`，见[官方镜像说明](https://hub.docker.com/_/postgres)。

`db:up` 等待容器健康后返回。数据库完成迁移后，`GET /api/v1/ready` 返回 `{"status":"ok","database":"ok"}`；数据库不可用或尚无 `app` schema 访问权限时返回 503。`GET /api/v1/health` 始终只表示进程可响应，CLI 的 `health` 命令调用的是该存活接口。

## 配置与账号

应用环境变量统一见[后端环境变量表](../README.md#环境变量)。应用启动只加载 `.env`，不加载数据库管理员和迁移账号的配置。生产环境通过运行环境注入 `DATABASE_URL`，不要复制本地配置。

本地管理配置来自 [.env.database.example](../.env.database.example)，实际值由初始化脚本生成：

| 变量 | 默认或生成方式 | 用途 |
| --- | --- | --- |
| `POSTGRES_PORT` | `5433` | Compose 在本机绑定的端口 |
| `POSTGRES_PASSWORD` | 随机生成 | 本地 PostgreSQL 管理员密码，仅用于初始化与隔离测试库管理 |
| `APP_DATABASE_PASSWORD` | 独立随机生成 | 首次初始化 `dev_ops_app` 角色的密码 |
| `MIGRATION_DATABASE_PASSWORD` | 独立随机生成 | 首次初始化 `dev_ops_migrator` 角色的密码 |
| `MIGRATION_DATABASE_URL` | 根据本地迁移密码生成 | 迁移命令使用的独立连接地址 |

`dev_ops_app` 只能连接数据库、访问 `app` schema、读写业务表和使用序列；它不能创建表或读取 `drizzle` 迁移记录。`dev_ops_migrator` 可以创建 schema 并持有迁移对象，但不是超级用户。基础迁移为该账号后续在 `app` 中创建的表和序列设置默认授权；若换用其他迁移角色，必须同步调整默认权限。参见 [PostgreSQL 默认权限](https://www.postgresql.org/docs/18/sql-alterdefaultprivileges.html)。

[容器初始化脚本](../docker/postgres/init.sql)仅在空数据卷首次启动时创建角色。修改本地密码文件不会更新已有数据库密码；凭据轮换需同时更新数据库角色密码及对应连接配置。`db:down` 保留数据卷，日常停止不删除数据库文件。

## 迁移流程

迁移生成配置位于 [drizzle.config.ts](../drizzle.config.ts)，只描述方言、schema 路径和输出目录，不包含凭据，也不需要在线数据库。[Drizzle Kit](https://orm.drizzle.team/docs/drizzle-kit-generate)生成 SQL 和快照，提交时必须包含整个 `server/drizzle/` 目录。

修改 `server/src/db/schema.ts` 后，使用 `pnpm --dir server db:generate --name=<变更名称>` 生成迁移。业务表通过 `appSchema.table(...)` 定义，禁止调用会生成外键的 `.references(...)` 或外键构造器。生成的 SQL 必须人工检查，并补充中文表、字段注释；已经执行的迁移不得修改。

需要自定义 SQL 时使用 `pnpm --dir server db:generate --custom --name=<变更名称>` 创建迁移文件。执行 `pnpm --dir server db:check` 检查迁移元数据，再运行 `pnpm --dir server db:migrate` 应用迁移。`db:check` 不连接数据库，也不等于 SQL 执行验证。

迁移命令只读取 `MIGRATION_DATABASE_URL`，不回退到应用账号。它使用独占会话锁防止本项目迁移命令并发执行，将已执行记录写入 `drizzle.__drizzle_migrations`，结束后关闭连接。重复执行不会重跑已记录的迁移。错误输出不包含 URL、密码或原始 SQL。

当前迁移执行器使用 Drizzle 的事务迁移，不支持在其中运行 `CREATE INDEX CONCURRENTLY` 等禁止处于事务块的语句。遇到此类变更需先设计独立的执行与记录方案，不能直接放入普通迁移。应用启动不自动迁移；部署应先备份、评估兼容性并单独执行迁移，再切换应用。

## 验证与常用命令

```bash
pnpm --dir server check
pnpm --dir server build
pnpm --dir server test:db
```

`check` 包含不依赖数据库的类型检查、静态检查和接口测试。`test:db` 要求本地数据库已启动，使用 `.env` 与 `.env.database` 中的本机连接信息；它创建随机命名的 `dev_ops_test_*` 数据库，测试结束后删除该测试库，不清空 `dev_ops`。

集成测试验证空库迁移、重复执行、已有数据保留、默认授权、真实唯一约束、Drizzle 事务回滚、超时、迁移互斥、就绪接口与连接释放。测试夹具表只存在于隔离测试库；新增业务表后应补充对应升级路径和无外键关联的一致性测试。

| 命令 | 用途 | 数据影响 |
| --- | --- | --- |
| `pnpm --dir server db:setup` | 生成本地配置 | 不覆盖已存在文件 |
| `pnpm --dir server db:up` | 启动并等待数据库健康 | 首次启动初始化角色与数据库 |
| `pnpm --dir server db:down` | 停止并移除本项目容器 | 保留数据卷 |
| `pnpm --dir server db:logs` | 查看数据库最近日志 | 只读 |
| `pnpm --dir server db:generate` | 生成待执行 SQL 与快照 | 写入本地迁移目录 |
| `pnpm --dir server db:check` | 检查迁移元数据 | 不执行 SQL |
| `pnpm --dir server db:migrate` | 执行尚未应用的迁移 | 使用迁移账号修改数据库 |
| `pnpm --dir server test:db` | 执行真实数据库测试 | 创建并删除独立测试库 |

## 部署边界

部署后端时，编译产物需连同 `server/drizzle/` 迁移目录和运行依赖一起提供。在 `server/` 目录使用 `node dist/db/migrate-cli.js` 运行编译后的迁移入口，凭据通过环境变量注入。运行 `node dist/server.js` 启动应用，网关或编排系统使用 `/api/v1/ready` 判断数据库就绪。

非本地环境应由管理员预建数据库及两个独立角色，按本地初始化脚本的权限边界配置；基础迁移中的应用角色名为 `dev_ops_app`。远程连接按数据库服务要求启用并验证 TLS，不通过关闭证书校验绕过错误。连接池上限应结合进程数量和数据库连接容量设置。迁移成功不代表所有业务数据升级均已验证，发布前仍需针对实际表结构验证备份恢复和升级路径。
