# bugs 模块

- 职责：Bug、需求关联、修复与回归记录
- 数据归属：bug、bug_requirement_link、bug_regression
- 计划任务：T060–T070
- 公开边界：提供 Bug 状态查询与需求关联；不自动改变需求状态；其他模块只能通过本目录 `public.ts` 调用。

当前仅初始化目录；分层文件按实际功能添加，不预建空壳 service/repository。整体边界见[目标架构](../../../../docs/architecture/system-design.md#5-server-结构与职责)与[任务清单](../../../../specs/001-v01-rd-workflow/tasks.md)。

## 实现状态（2026-11-10）

- 已实现 `bug`、`bug_requirement_link`、`bug_regression` 表与 0006 迁移、中文注释。
- 状态机：待处理 → 修复中 → 待回归 → 回归失败/通过；支持撤回回归、关闭（重复/非缺陷/不处理）与重开；历史回归记录保留。
- 需求关联仅限同项目，移除必须填写原因；待回归部分唯一索引防止并存多条 pending 回归。
- 项目未解决 Bug 计数已接入 `ProjectCountsReader`。
- 测试：`test/http/bugs.test.ts`、`test/integration/bugs.test.ts`。
