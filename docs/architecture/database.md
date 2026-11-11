# PostgreSQL 与 Drizzle

后端使用 PostgreSQL 18、Drizzle ORM 和 `pg` 连接池。[连接实现](../../apps/server/src/platform/database/client.ts)负责超时、UTC 会话和连接回收，[schema 定义](../../apps/server/src/bootstrap/database-schema.ts)统一导出 `app` schema，[迁移入口](../../apps/server/src/platform/database/migrate.ts)执行版本化 SQL。当前仅初始化基础 schema 与权限，业务表在具体功能开发时增加。

## 本地初始化

需要启动 Docker，并使用根目录 `.nvmrc` 指定的 Node.js 版本。以下命令均在项目根目录执行：

```bash
pnpm install --frozen-lockfile
pnpm --dir apps/server db:setup
pnpm --dir apps/server db:up
pnpm --dir apps/server db:migrate
pnpm --dir apps/server dev
```

`db:setup` 生成 `apps/server/.env` 和 `apps/server/.env.database`，分别保存应用连接配置和本地数据库管理配置。密码独立随机生成，文件权限为仅当前用户可读写；再次执行保留原文件。如果只有一份文件存在，命令会停止，需按示例补齐配置，避免意外重置凭据。

[Compose 配置](../../deploy/compose.yaml)使用 `postgres:18-alpine`，绑定 `127.0.0.1:5433`，数据库名为 `dev_ops`，数据存入项目独立命名卷。修改端口时，同时修改 `.env.database` 的 `POSTGRES_PORT`、`MIGRATION_DATABASE_URL` 和 `.env` 的 `DATABASE_URL`。PostgreSQL 18 的卷挂载在 `/var/lib/postgresql`，见[官方镜像说明](https://hub.docker.com/_/postgres)。

`db:up` 等待容器健康后返回。数据库完成迁移后，`GET /api/v1/ready` 返回 `{"status":"ok","database":"ok"}`；数据库不可用或尚无 `app` schema 访问权限时返回 503。`GET /api/v1/health` 始终只表示进程可响应，CLI 的 `health` 命令调用的是该存活接口。

## 配置与账号

应用环境变量统一见[后端环境变量表](../../apps/server/README.md#环境变量)。应用启动只加载 `.env`，不加载数据库管理员和迁移账号的配置。生产环境通过运行环境注入 `DATABASE_URL`，不要复制本地配置。

本地管理配置来自 [.env.database.example](../../apps/server/.env.database.example)，实际值由初始化脚本生成：

| 变量 | 默认或生成方式 | 用途 |
| --- | --- | --- |
| `POSTGRES_PORT` | `5433` | Compose 在本机绑定的端口 |
| `POSTGRES_PASSWORD` | 随机生成 | 本地 PostgreSQL 管理员密码，仅用于初始化与隔离测试库管理 |
| `APP_DATABASE_PASSWORD` | 独立随机生成 | 首次初始化 `dev_ops_app` 角色的密码 |
| `MIGRATION_DATABASE_PASSWORD` | 独立随机生成 | 首次初始化 `dev_ops_migrator` 角色的密码 |
| `MIGRATION_DATABASE_URL` | 根据本地迁移密码生成 | 迁移命令使用的独立连接地址 |

`dev_ops_app` 只能连接数据库、访问 `app` schema、读写业务表和使用序列；它不能创建表或读取 `drizzle` 迁移记录。`dev_ops_migrator` 可以创建 schema 并持有迁移对象，但不是超级用户。基础迁移为该账号后续在 `app` 中创建的表和序列设置默认授权；若换用其他迁移角色，必须同步调整默认权限。参见 [PostgreSQL 默认权限](https://www.postgresql.org/docs/18/sql-alterdefaultprivileges.html)。

[容器初始化脚本](../../deploy/postgres/init.sql)仅在空数据卷首次启动时创建角色。修改本地密码文件不会更新已有数据库密码；凭据轮换需同时更新数据库角色密码及对应连接配置。`db:down` 保留数据卷，日常停止不删除数据库文件。

## 迁移流程

迁移生成配置位于 [drizzle.config.ts](../../apps/server/drizzle.config.ts)，只描述方言、schema 路径和输出目录，不包含凭据，也不需要在线数据库。[Drizzle Kit](https://orm.drizzle.team/docs/drizzle-kit-generate)生成 SQL 和快照，提交时必须包含整个 `apps/server/drizzle/` 目录。

在业务模块中定义表并从 `apps/server/src/bootstrap/database-schema.ts` 汇总后，使用 `pnpm --dir apps/server db:generate --name=<变更名称>` 生成迁移。业务表通过 `appSchema.table(...)` 定义，禁止调用会生成外键的 `.references(...)` 或外键构造器。生成的 SQL 必须人工检查，并补充中文表、字段注释；已经执行的迁移不得修改。

需要自定义 SQL 时使用 `pnpm --dir apps/server db:generate --custom --name=<变更名称>` 创建迁移文件。执行 `pnpm --dir apps/server db:check` 检查迁移元数据，再运行 `pnpm --dir apps/server db:migrate` 应用迁移。`db:check` 不连接数据库，也不等于 SQL 执行验证。

迁移命令只读取 `MIGRATION_DATABASE_URL`，不回退到应用账号。它使用独占会话锁防止本项目迁移命令并发执行，将已执行记录写入 `drizzle.__drizzle_migrations`，结束后关闭连接。重复执行不会重跑已记录的迁移。错误输出不包含 URL、密码或原始 SQL。

当前迁移执行器使用 Drizzle 的事务迁移，不支持在其中运行 `CREATE INDEX CONCURRENTLY` 等禁止处于事务块的语句。遇到此类变更需先设计独立的执行与记录方案，不能直接放入普通迁移。应用启动不自动迁移；部署应先备份、评估兼容性并单独执行迁移，再切换应用。

## 验证与常用命令

```bash
pnpm --dir apps/server check
pnpm --dir apps/server build
pnpm --dir apps/server test:db
```

`check` 包含不依赖数据库的类型检查、静态检查和接口测试。`test:db` 要求本地数据库已启动，使用 `.env` 与 `.env.database` 中的本机连接信息；它创建随机命名的 `dev_ops_test_*` 数据库，测试结束后删除该测试库，不清空 `dev_ops`。

集成测试验证空库迁移、重复执行、已有数据保留、默认授权、真实唯一约束、Drizzle 事务回滚、超时、迁移互斥、就绪接口与连接释放。测试夹具表只存在于隔离测试库；新增业务表后应补充对应升级路径和无外键关联的一致性测试。

| 命令 | 用途 | 数据影响 |
| --- | --- | --- |
| `pnpm --dir apps/server db:setup` | 生成本地配置 | 不覆盖已存在文件 |
| `pnpm --dir apps/server db:up` | 启动并等待数据库健康 | 首次启动初始化角色与数据库 |
| `pnpm --dir apps/server db:down` | 停止并移除本项目容器 | 保留数据卷 |
| `pnpm --dir apps/server db:logs` | 查看数据库最近日志 | 只读 |
| `pnpm --dir apps/server db:generate` | 生成待执行 SQL 与快照 | 写入本地迁移目录 |
| `pnpm --dir apps/server db:check` | 检查迁移元数据 | 不执行 SQL |
| `pnpm --dir apps/server db:migrate` | 执行尚未应用的迁移 | 使用迁移账号修改数据库 |
| `pnpm --dir apps/server test:db` | 执行真实数据库测试 | 创建并删除独立测试库 |

## V0.2 新增表（迁移 0014–0016）

V0.2 在无外键前提下新增以下业务表，关联一致性由 service 事务与条件更新保证：

| 表 | 归属 | 说明 |
| --- | --- | --- |
| `build_record`、`build_record_correction`、`build_artifact`、`build_record_target` | delivery | 交付上报、更正与三类产物引用 |
| `service_run_version`、`service_run_version_change` | delivery | 服务三环境实际运行版本与变更历史 |
| `pipeline_run`、`pipeline_run_status` | delivery | 外部流水线运行记录与状态历史；V0.4a 迁移 0020 已按 A-05 决策删除（本机旧表 0 行，无生产数据） |
| `external_review`、`release_result` | delivery | 外部提审与实际发布，两者分离 |
| `credential`、`credential_version`、`credential_project_grant`、`credential_usage` | configuration | 团队凭据元数据、版本密文、授权与使用记录 |
| `project_env_var` | configuration | 项目三环境变量与凭据引用 |
| `project_service`、`project_service_repository` | projects | 服务目录与仓库映射 |
| `team.icon_text`、`team.description`、`team.version` | identity | 团队资料与乐观锁版本 |
| `skill`、`skill_version`、`agent_template`、`agent_template_version`、`project_template_selection`、`template_snapshot_link` | knowledge | V0.3 知识资产：技能/模板当前元数据与内容版本、项目选用、快照链接；`activity` 实体类型扩展为 `skill`/`agent_template`，错误码复用现有业务码 |

凭据明文只在创建/轮换请求体出现，使用 AES-256-GCM 加密后写入 `credential_version`，响应只返回元数据与固定掩码；环境变量引用凭据时只保存整数标识，撤销或授权缩小时同事务将引用变量置为失效。上述表均通过版本化迁移生成，迁移编号以 `apps/server/drizzle/meta/_journal.json` 为准。

### V0.3 knowledge 表与约束

- 6 张表均启用中文表/列注释（迁移 0017、0018），主键 UUID，无外键；团队隔离字段 `team_id` 随表携带，关联一致性由 service 事务与条件更新保证。
- `skill.version` 是乐观锁修订号，内容版本存于 `skill_version.content_version`（三段式由成员维护）；`skill_version.files` 为 JSONB 资源文件快照。
- `agent_template.version` 为乐观锁，`agent_template_version.version` 为整数内容版本；`project_template_selection.project_id` 唯一，保证一个项目至多一个当前模板。
- `template_snapshot_link` 只保存令牌摘要与模板版本，不保存正文；打开链接仍要求登录与团队成员权限，不提供匿名/公网访问。
- 知识模块写操作只写自身表与 `activity`，不写项目、需求、Bug、交付或远端仓库；技能/模板停用与编辑不删除历史版本。
- 错误码复用 `VALIDATION_ERROR`、`FORBIDDEN`、`NOT_FOUND`、`VERSION_CONFLICT`、`PRECONDITION_FAILED`，不新增知识专属码。

## V0.4a pipeline 表（迁移 0020–0021）

V0.4a 新增 `pipeline` 模块的 7 张表，替代已下线的 `delivery` 外部流水线上报表。表只保存运行事实与元数据，日志与产物正文保存在 `PIPELINE_STORAGE_DIR` 下的本地目录；无外键，关联一致性由 pipeline service 的事务、条件更新与租约约束保证。

| 表 | 说明 |
| --- | --- |
| `pipeline_run` | 平台创建的一次运行：固定提交 SHA、工作流快照与哈希、运行计划、输入、状态、幂等键、节点、超时与失败/取消信息；`project_id + idempotency_key` 唯一 |
| `pipeline_run_step` | 运行内步骤执行事实：全局 `step_index`、类型（run/builtin）、状态、退出码、错误摘要与起止时间；`run_id + step_index` 唯一 |
| `pipeline_run_log` | 日志分片元数据：步骤、序号、存储相对路径、大小；`run_id + step_index + seq` 唯一，重复分片不重复写入 |
| `pipeline_artifact` | 产物元数据：名称、大小、SHA-256、所属步骤与可用状态；`run_id + name` 唯一 |
| `pipeline_node` | 团队执行节点：状态、能力标签、操作系统/架构、并发上限、Agent 版本与最近心跳 |
| `pipeline_node_token` | 一次性注册令牌与 Agent 长期令牌的 SHA-256 哈希、状态与撤销信息，不保存明文 |
| `pipeline_lease` | 运行与节点的调度租约：租约令牌哈希、有效期与释放状态；部分唯一索引保证同一运行至多一个活动租约 |

约束要点：

- 运行状态 CHECK 取值为 `queued`/`assigned`/`running`/`cancelling`/`succeeded`/`failed`/`cancelled`/`interrupted`；步骤状态为 `pending`/`running`/`succeeded`/`failed`/`skipped`/`cancelled`；节点状态为 `pending`/`online`/`draining`/`offline`/`disabled`。
- 调度 Worker 用 `SELECT ... FOR UPDATE SKIP LOCKED` 领取待调度运行，租约过期或节点心跳超时由 Worker 收口为 `interrupted`，不自动改派同一运行。
- 迁移 0020 删除旧 `delivery.pipeline_run`、`pipeline_run_status` 并创建 pipeline 表、索引与 `uk_pipeline_lease_active_run` 部分唯一索引；迁移 0021 补齐中文表/列注释并将 `activity` 实体类型白名单扩展到 `pipeline_run`、`pipeline_node`。
- `activity` 新增 `pipeline_run`、`pipeline_node` 实体类型，用于记录触发、取消、节点变更与产物下载；不新增数据库外键。
- 日志与产物存储布局为 `<PIPELINE_STORAGE_DIR>/runs/<runId>/{logs/<stepIndex>/<seq>.log,artifacts/<artifactId>.bin}`，数据库只保存相对 `storage_key`，读取时校验仍在存储根目录内。

## 部署边界

部署后端时，编译产物需连同 `apps/server/drizzle/` 迁移目录和运行依赖一起提供。在 `apps/server/` 目录使用 `node dist/entrypoints/migrate.js` 运行编译后的迁移入口，凭据通过环境变量注入。运行 `node dist/entrypoints/http.js` 启动应用，网关或编排系统使用 `/api/v1/ready` 判断数据库就绪。

非本地环境应由管理员预建数据库及两个独立角色，按本地初始化脚本的权限边界配置；基础迁移中的应用角色名为 `dev_ops_app`。远程连接按数据库服务要求启用并验证 TLS，不通过关闭证书校验绕过错误。连接池上限应结合进程数量和数据库连接容量设置。迁移成功不代表所有业务数据升级均已验证，发布前仍需针对实际表结构验证备份恢复和升级路径。

## 补充：V0.4b 表与迁移（2026-11-11）

- 迁移 `0022_v04b_deploy_release.sql` 新建：`project_capability_grant`、`tool_invocation`、`code_change`、`change_plan`、`change_plan_approval`、`change_execution`、`change_plan_event`，并为 `pipeline_run` 增加 `run_kind`（默认 `workflow`）与 `secret_environment`（默认 `production`）。
- 部分唯一索引：`uk_project_capability_grant_active` 保证同一项目/用户/能力只有一条有效授权；`uk_change_plan_active_target` 保证同一服务 + 环境只有一条 `approved/executing/verifying` 计划。
- 迁移只新增表与列，不改写 V0.4a 数据；已在本地 PostgreSQL 18 完成空库迁移验证。生产升级前仍需按实际数据备份并验证升级路径。
- 事件表 `change_plan_event` 只增不改；计划/放行/执行/事件均不保存凭据明文、补丁正文或远端响应全文。

## V0.5 附件与储存桶（迁移 0023）

- 迁移 `0023_attachments_storage.sql` 新建 `storage_bucket`（平台级桶配置、内置本地桶与 S3 兼容桶、凭据密文列、探测结论）、`storage_bucket_event`（平台级配置审计）、`attachment`（业务附件，状态 `temp`/`bound`/`removed`）、`bug_collaborator`（缺陷协作人关系），并把 `activity` 实体类型白名单扩展到 `attachment`。
- 部分唯一索引 `uk_storage_bucket_default` 保证同一时刻至多一个默认桶；`attachment` 部分索引分别服务详情列表、临时附件清理、`removed` 待删对象重试与桶引用计数。
- 迁移内种入内置本地桶（固定 UUID `00000000-0000-4000-8000-000000000001`），服务启动时校验存在与不变量：缺失补建、被误改则阻止启动。
- 附件内容写入 `ATTACHMENT_STORAGE_DIR` 或平台配置的 S3 兼容桶；数据库只保存 `bucket_id`/`storage_key`/大小/`sha256` 等元数据，读取按记录固定的桶解析，不随默认桶切换变化。
- 对象删除不在数据库事务内执行：事务只把状态置为 `removed` 并写活动，提交后删除对象，失败由 Worker 清理任务重试。
