# integrations 模块

- 职责：Git 连接、授权回调与提供方注册
- 数据归属：git_connection
- 计划任务：T071–T087
- 公开边界：管理连接与授权状态；不保存业务项目的状态；其他模块只能通过本目录 `public.ts` 调用。

当前仅初始化目录；分层文件按实际功能添加，不预建空壳 service/repository。整体边界见[目标架构](../../../../docs/architecture/system-design.md#5-server-结构与职责)与[任务清单](../../../../specs/001-v01-rd-workflow/tasks.md)。

## 实现状态（2026-11-10）

- 已实现 `git_connection` 表、0010 迁移与中文注释。
- 已实现连接创建/检查/同步/撤权、GitHub App 授权 state/回调、Gitea Token 加密写入、仓库快照同步与撤权清理。
- 适配器通过 `createGitAdapter` 解析；code 模块使用 integrations 的 `getAdapterForConnection` 与 `listActiveConnections`。
- 测试：`test/http/git.test.ts`、`test/integration/git.test.ts`。
