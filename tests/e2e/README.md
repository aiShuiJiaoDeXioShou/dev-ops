# 跨应用联通测试

在仓库根目录先执行 `pnpm build`，再执行 `pnpm test:e2e`。根级 `pnpm check` 已包含这两个步骤。

测试启动临时 Fastify 服务和 Vite 开发服务，验证共享客户端、编译后的 CLI、Web 深链接回退及真实 `/api` 代理。服务使用临时端口，结束后关闭；数据库不可用场景通过真实就绪响应验证。

本目录当前验证网络和进程联通，不包含浏览器自动化。页面交互、缓存和导航由 Web 的组件测试覆盖，数据库迁移和事务由 `pnpm test:db` 覆盖。业务流程和浏览器端到端用例随真实功能添加。

`bot-collaboration.test.mjs` 使用本机隔离 PostgreSQL、真实 HTTP、已构建 CLI 和确定性 faux 模型验证会话长任务：待办持久化、运行令牌调用、等你回复与继续完成、凭据撤销、历史任务只读。Mac 使用默认沙盒和平台网关；其他平台显式使用完全访问模式。测试自行创建临时 `devops` 命令入口，无需模型凭据，也不依赖手工安装的 CLI。仅运行此项可用 `node --test tests/e2e/bot-collaboration.test.mjs`。
