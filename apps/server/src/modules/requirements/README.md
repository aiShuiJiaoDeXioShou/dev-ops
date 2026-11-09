# requirements 模块

- 职责：需求、协作人员、提测记录与需求状态流转
- 数据归属：requirement、requirement_collaborator、requirement_test_submission
- 计划任务：T048–T059、T088–T097
- 公开边界：提供需求摘要与访问校验；不执行构建或发布；其他模块只能通过本目录 `public.ts` 调用。

当前仅初始化目录；分层文件按实际功能添加，不预建空壳 service/repository。整体边界见[目标架构](../../../../docs/architecture/system-design.md#5-server-结构与职责)与[任务清单](../../../../specs/001-v01-rd-workflow/tasks.md)。

## 实现状态（2026-11-10）

- 已实现 `requirement`、`requirement_collaborator` 表与 0005 迁移、中文注释。
- 已实现列表/详情/创建/更新、评论读写与活动分页；详情暂以空数组返回关联 Bug/代码引用，最新提测为 `null`。
- 项目内编号在事务内锁定项目行后生成；仅 `pending`/`in_development` 可修改范围字段；`version` 乐观锁。
- 项目未完成需求计数已接入；Bug 计数待 US4。
- 测试：`test/http/requirements.test.ts`、`test/integration/requirements.test.ts`（含并发编号、协作人员去重、版本冲突与权限）。

## 研发流程（2026-11-10）

- 新增 `requirement_test_submission` 表与 0007 迁移；提测记录、自测结论与历史保留。
- 已实现开始开发、提测、开始测试、撤回测试、退回开发、通过资格检查、测试通过、重新开发、取消、恢复；全部按 `version` 条件更新并写活动。
- 提测通过前查询关联 Bug 状态；存在未解决/未关闭 Bug 时返回 `PRECONDITION_FAILED` 与阻碍项。
- 需求详情返回 `linkedBugs`、最新提测记录与 `needsReview`；已通过需求在关联 Bug 重开/新增活动 Bug 后显示复核标记。
- 测试：`test/http/requirements-workflow.test.ts`、`test/integration/workflow.test.ts`。
