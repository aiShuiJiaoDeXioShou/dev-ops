# 本地依赖环境

[compose.yaml](compose.yaml) 提供 PostgreSQL 18，[初始化脚本](postgres/init.sql) 创建本地应用与迁移角色。工作区默认使用项目名 `dev-ops` 和 `dev-ops_postgres_data` 数据卷，移动配置文件不会改变数据卷名称。

在仓库根目录运行：

```bash
pnpm db:setup
pnpm db:up
pnpm db:migrate
```

本地配置保存在 `apps/server/.env` 与 `apps/server/.env.database`，初始化命令保留已存在的配置。`pnpm db:up` 同时启动 Mailpit（SMTP `127.0.0.1:1025`，Web `http://127.0.0.1:8025`）；应用 `.env` 使用 `SMTP_URL=smtp://127.0.0.1:1025`。`pnpm db:down` 停止本项目容器并保留数据卷。

连接、账号权限、迁移与测试说明统一见[数据库说明](../docs/architecture/database.md)。本目录当前只包含本地数据库环境，生产 Web 网关和应用部署配置按实际运行环境建立。

## 邮件与应用初始化

本地可运行 Mailpit（`smtp://127.0.0.1:1025`）并配置 `apps/server/.env` 的 `SMTP_URL=smtp://127.0.0.1:1025`；stg 使用 Resend SMTP，需同时设置 `MAIL_FROM`。首次启动后运行 `pnpm --dir apps/server seed:root` 创建平台 root，不要提交真实凭据或 `.env`。
