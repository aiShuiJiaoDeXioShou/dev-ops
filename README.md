# 项目开发平台

产品定位、已确认需求及待定事项见[项目管理与运维平台需求](docs/prd/mvp.md)。

模块划分、功能优先级和版本验收见[需求版本规划](docs/prd/release-plan.md)，当前为规划草案。

全项目的模块图、功能图和逻辑区域架构图见[项目结构图](docs/prd/project-maps.md)，可直接编辑 Mermaid 源图。

首版功能清单、业务流程、验收标准和待确认问题见 [V0.1 需求细化](docs/prd/v0.1.md)。

全新的工作区结构、Web 与 Server 模块边界及搭建范围见[目标架构方案](docs/architecture/system-design.md)，目标方案已确认，工作区和基础工程已搭建，业务模块按实际需求加入。

前后端推荐组件、集成方式、测试方案和待补齐内容见[技术选型与集成方案](docs/technical-selection.md)。前端路由、查询缓存与基础 UI 已接入，认证和业务流程仍待实现。

界面与主要操作可查看 [HTML 交互原型](.mobile-workspace/design/interactive-prototype-v1/index.html)，打开方式和演示边界见[原型说明](.mobile-workspace/design/interactive-prototype-v1/README.md)。

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

CLI 首次使用前执行 `pnpm prepare:clients`，之后查看帮助或检查运行中的服务：

```bash
pnpm cli --help
pnpm cli health --json
```

完整验证与构建命令：

```bash
pnpm check
pnpm test:db
```

`pnpm check` 从后端 TypeBox 路由导出契约，生成 API 类型及独立校验器，构建所有应用，检查模块依赖，再运行工程、应用和跨应用联通测试。除 `test:db` 外，无需预先启动数据库或后端。`pnpm test:db` 使用本机 PostgreSQL，在隔离测试库中验证迁移、权限与事务，结束后删除测试库。

`pnpm build` 只执行契约生成和全部构建。单独检查某个应用前先执行 `pnpm prepare:clients`；运行端到端测试 `pnpm test:e2e` 前先完成 `pnpm build`。

后端配置和接口见[后端说明](apps/server/README.md)。PostgreSQL 默认监听 `127.0.0.1:5433`，部署配置位于 [deploy](deploy/README.md)，数据和迁移操作见[数据库说明](docs/architecture/database.md)。共享客户端与工程工具分别见 [API 客户端](packages/api-client/README.md)和[工程工具](tooling/README.md)。
