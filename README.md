# 项目开发平台

产品定位、已确认需求及待定事项见[项目管理与运维平台需求](docs/prd/mvp.md)。

界面与主要操作可查看 [HTML 交互原型](.mobile-workspace/design/interactive-prototype-v1/index.html)，打开方式和演示边界见[原型说明](.mobile-workspace/design/interactive-prototype-v1/README.md)。

前端位于 [apps/web](apps/web/README.md)，后端位于 [server](server/README.md)，命令行工具位于 [apps/cli](apps/cli/README.md)。三个项目分别管理依赖和锁文件，协作规则见 [AGENTS.md](AGENTS.md)。

在仓库根目录执行 `nvm use`。首次开发先初始化数据库：

```bash
pnpm --dir server install --frozen-lockfile
pnpm --dir server db:setup
pnpm --dir server db:up
pnpm --dir server db:migrate
```

然后在两个终端分别运行：

```bash
pnpm --dir server dev
```

```bash
pnpm --dir apps/web dev
```

后端启动方式、配置项和接口地址见[后端说明](server/README.md)。技术方案与待定事项见[后端选型规划](server/docs/architecture.md)。

CLI 初始化依赖并查看帮助：

```bash
pnpm --dir apps/cli install --frozen-lockfile
pnpm --dir apps/cli dev --help
```

后端运行后，执行 `pnpm --dir apps/cli dev health` 检查进程存活。完整参数、构建方式和退出码见 [CLI 说明](apps/cli/README.md)。

后端已接入 PostgreSQL 18 与 Drizzle。数据库默认监听 `127.0.0.1:5433`；配置、迁移、账号权限及数据保留规则见[数据库说明](server/docs/database.md)。
