# projects 模块

- 职责：项目资料、负责人、项目状态与计数
- 数据归属：project
- 计划任务：T038–T047
- 公开边界：提供项目访问校验与项目摘要；不维护需求/Bug 状态；其他模块只能通过本目录 `public.ts` 调用。

当前仅初始化目录；分层文件按实际功能添加，不预建空壳 service/repository。整体边界见[目标架构](../../../../docs/architecture/system-design.md#5-server-结构与职责)与[任务清单](../../../../specs/001-v01-rd-workflow/tasks.md)。

## 实现状态（2026-11-10）

- 已实现 `project` 表、0004 迁移与中文注释。
- 已实现列表/详情/创建/更新/统计接口：团队内唯一名称、负责人校验、项目状态与原因、`version` 乐观锁、活动记录。
- 计数通过 `ProjectCountsReader` 注入，当前为 0；需求/Bug 模块接入后替换真实计数。
- 测试：`test/http/projects.test.ts`、`test/integration/projects.test.ts`。
