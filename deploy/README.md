# 本地依赖环境

[compose.yaml](compose.yaml) 提供 PostgreSQL 18，[初始化脚本](postgres/init.sql) 创建本地应用与迁移角色。工作区默认使用项目名 `dev-ops` 和 `dev-ops_postgres_data` 数据卷，移动配置文件不会改变数据卷名称。

在仓库根目录运行：

```bash
pnpm db:setup
pnpm db:up
pnpm db:migrate
```

本地配置保存在 `apps/server/.env` 与 `apps/server/.env.database`，初始化命令保留已存在的配置。`pnpm db:down` 停止本项目容器并保留数据卷。

连接、账号权限、迁移与测试说明统一见[数据库说明](../docs/architecture/database.md)。本目录当前只包含本地数据库环境，生产 Web 网关和应用部署配置按实际运行环境建立。
