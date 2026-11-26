---
name: devops-workflow
description: 在本仓库做需求开发、技术改进或 Bug 修复时使用，包括只制定计划。覆盖从查找或登记 DevOps 事项、拆分待办、上传设计稿与截图等产物，到提交后关联代码、回写验证结果并提测或提交回归的完整流程，统一通过 devops work 命令完成。也用于查询事项与流水线，以及按用户要求发布本仓库。
---

# DevOps 事项流程

本仓库的每次修改都挂在 DevOps `devops` 项目的一个需求或 Bug 上（AGENTS.md「DevOps 事项追踪」）。`devops work` 把当前工作区绑定到事项，并把待办、附件、代码关联和流转封装成单条命令。仓库为 Codex 和 Claude Code 配置了 hooks：未绑定事项时拒绝修改文件，结束前若还有缺项会要求补完。hooks 只是兜底，按下面五个阶段主动完成。

| 阶段 | 完成标准 |
| ---- | -------- |
| 1 认领 | `devops work status` 显示已绑定事项，状态为开发中或修复中 |
| 2 规划 | 符合拆分条件的事项已有待办；方案取舍已记录 |
| 3 实施 | 每个完成的待办都有对应提交并已勾选；过程产物已上传 |
| 4 交付 | 代码已关联，验证结果已回写，需求已提测或 Bug 已提交回归 |
| 5 收尾 | 交付说明列出事项编号、当前状态、验证结果和未验证项 |

## 1 认领

- 用户给了编号或链接：运行 `devops work start REQ-12` 或 `devops work start BUG-3`。命令按 Git 远端找到项目，待处理的事项会自动流转为开发中或修复中。
- 只给了描述：用 `devops requirement list --project <项目ID> --search <关键词> --json` 或 `devops bug list` 查找。查不到时登记，功能或技术改进登记为需求，缺陷登记为 Bug：
  - 需求写清范围和验收标准：`devops requirement create --project <项目ID> --title ... --content-file - --acceptance ...`
  - Bug 写清现象、预期行为和复现条件：`devops bug create --project <项目ID> --title ... --phenomenon ... --expected ... --reproduction ...`
  - Bug 属于已有需求时运行 `devops bug link-requirement`。
- 负责人和测试负责人向用户确认，不要猜用户 ID。
- 用户只要求制定计划时，用 `devops requirement create/update --plan-file` 写入范围和待办，不运行 `work start`，因为它会流转状态。
- 只读排查和咨询不需要事项。确实无需事项的修改（平台故障恢复、用户明确说不登记）运行 `devops work start --untracked "<原因>"`。

## 2 规划

满足任一条件时必须拆分待办：

- 改动跨两个及以上 `apps/*` 或 `packages/*`；
- 涉及接口契约、数据库迁移、共享组件或核心交互；
- 预计超过一天，或需要多次提交；
- 用户要求拆分。

一个待办对应一个能独立验收的提交，跨端功能按 AGENTS.md 拆成后端、共享客户端、前端。标题写交付结果，例如“登录接口返回账号锁定状态”，不要写“修改代码”。

```sh
devops work task add "登录接口返回锁定状态" "api-client 重新生成" "登录页展示锁定提示"
devops work log "锁定判断放在服务端：前端无法获知失败次数"
```

需要节点、排期或多阶段时，按 [规划说明](references/planning.md) 维护完整规划。

## 3 实施

- 产生设计稿 HTML、界面截图、测试报告或性能数据时立即上传，规则见[产物上传](references/artifacts.md)：
  `devops work attach ./design.html --kind design --note "首页改版设计稿"`
- 每完成一个待办：先按 AGENTS.md 提交，再运行 `devops work task done t1`。
- 范围、负责人、排期变化或遇到阻塞时，用 `devops work log` 记录，必要时 `devops requirement update` 更新事项。
- 推送后 hook 会自动运行 `devops work link`。没有 hooks 的工具手动运行。

## 4 交付

先完成 AGENTS.md 要求的检查，再回写：

```sh
# 需求：关联代码、写交付记录并提测
devops work deliver --summary "登录页锁定提示" \
  --verification "pnpm --dir apps/server check 通过；pnpm ui:check 通过；未做 390 宽度截图" \
  --self-test passed

# Bug：关联代码、写交付记录并提交回归
devops work deliver --summary "修复锁定后仍可登录" --verification "新增回归用例通过"
```

- `--verification` 写实际运行的命令和结果，没运行的检查要写明。自测结论如实填写 `passed`、`has_failures`、`not_run` 或 `not_applicable`。
- 有 PR 时在 PR 描述写事项编号或链接，并加 `--pr <编号>`。
- 只有本地提交时，交付记录会列出 SHA。推送前先问用户，推送后运行 `devops work link`。
- 输出中有 `transition.skipped` 时，把原因转告用户。缺测试负责人时，向用户确认后加 `--test-owner <用户ID>` 重新交付。
- 阶段性交付或用户尚未确认提测时，加 `--no-transition`。

## 5 收尾

- 交付说明列出事项编号、当前状态、实际验证结果和未验证项。
- 事项结束后运行 `devops work stop`；切换事项时直接 `devops work start` 新事项。
- 测试或验收结论由测试人员记录，编码助手不执行 `pass-test`、`record-regression`。

## Hooks

Codex 读取 `.codex/hooks.json`，Claude Code 读取 `.claude/settings.json`，两者调用同一脚本 `tooling/agent-hooks/devops-hook.mjs`：

| 时机 | 行为 |
| ---- | ---- |
| 会话开始 | 注入绑定事项、待办进度和缺项 |
| 修改仓库文件前 | 未绑定事项时拒绝，提示 `work start` |
| `git commit` / `git push` 后 | 提醒勾选待办；推送后自动关联提交 |
| 结束前 | 有已推送未关联的提交，或有新提交未回写时，要求补完一次 |

- 首次使用要在 Codex 的 `/hooks` 中信任项目 hooks，Claude Code 同样在 `/hooks` 审核。hooks 文件修改后需重新信任。
- hook 优先使用仓库内构建的 CLI（`pnpm --dir apps/cli build`），否则使用 PATH 中的 `devops`。
- 平台故障时设置 `DEVOPS_HOOKS_DISABLED=1`，并按 AGENTS.md 第 5 条在交付说明中记录。

## 其他操作

- 查询事项、流水线和发布本仓库：见[查询与发布](references/release.md)。
- 命令参数：[CLI 说明](../../../apps/cli/README.md)与 `devops <命令> --help`。
