# collaboration 模块

- 职责：评论与活动记录
- 数据归属：comment、activity
- 计划任务：T019 及业务模块阶段
- 公开边界：提供事务内追加与按事项分页读取；不拥有业务状态；其他模块只能通过本目录 `public.ts` 调用。

当前仅初始化目录；分层文件按实际功能添加，不预建空壳 service/repository。整体边界见[目标架构](../../../../docs/architecture/system-design.md#5-server-结构与职责)与[任务清单](../../../../specs/001-v01-rd-workflow/tasks.md)。

## 实现状态（2026-11-10）

- 已实现 `comment`、`activity` 表与 0002 迁移；只保存安全字段快照，不保存凭据或远端敏感正文。
- 已实现 `collaboration.repository.ts`、`collaboration.service.ts`、`public.ts`：支持根连接或事务执行器、分页读取、目标类型与文本长度校验。
- 集成测试：`apps/server/test/integration/collaboration.test.ts`，覆盖事务内追加、分页和非法目标类型。
