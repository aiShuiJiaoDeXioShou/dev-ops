# code 模块

- 职责：仓库、项目仓库关系、代码引用与来源核对
- 数据归属：git_repository、project_repository、code_reference
- 计划任务：T071–T087
- 公开边界：通过 Git 提供方端口读取来源；不实现来源写入；其他模块只能通过本目录 `public.ts` 调用。

当前仅初始化目录；分层文件按实际功能添加，不预建空壳 service/repository。整体边界见[目标架构](../../../../docs/architecture/system-design.md#5-server-结构与职责)与[任务清单](../../../../specs/001-v01-rd-workflow/tasks.md)。

## 实现状态（2026-11-10）

- 已实现 `git_repository`、`project_repository`、`code_reference` 表与 0011 迁移、中文注释。
- 已实现项目仓库清单/可关联仓库/关联/移除，以及代码引用创建/刷新/移除；目标事项必须属于当前项目，仓库必须已关联且连接可用。
- 来源核对失败时引用标记为 `auth_failed`/`not_found`/`timeout`/`unavailable` 并清空快照，不返回旧值冒充当前。
- 单事项代码引用上限 20；引用唯一约束兜底；移除写活动。
- 测试：`test/http/code.test.ts`、`test/integration/code.test.ts`。integrations 服务尚未接线，当前通过依赖注入提供适配器解析。
