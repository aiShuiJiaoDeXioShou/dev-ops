# 平台体验审计与自举迭代（第 1 期）实施证据

**日期**：2026-11-11

## 1. 审计范围与结论

- 方式：真实浏览器（Playwright，桌面 1440×1000 / 移动 390×844）操作真实后端与 PostgreSQL；管理员、开发者、浏览者三类账号；API 直接探测与数据库交叉核对；CLI 全命令枚举执行。
- 审计产出（工作区临时文件，不提交仓库）：
  - 平台级页面：32 条问题（P0 2 / P1 10 / P2 20）
  - 项目工作区：19 条问题（P0 0 / P1 5 / P2 14）
  - API 与权限：11 条问题（P0 1 / P1 2 / P2 8）
  - CLI：22 条问题（P0 2 / P1 7 / P2 13）
- 通过项：viewer 只读、状态机流转、筛选 URL 保留、空/无匹配/失败态、附件权限、变更计划自审批禁止、统一响应信封（除已修复的邀请冲突）、凭据明文审计等。

## 2. 本轮修复

### 服务端 / API

- 邀请重复：统一 `isUniqueViolation` 并递归解包 `DrizzleQueryError.cause`，重复待接受邀请由 500 改为 HTTP 200 + `DUPLICATE_RELATION`。
- 忘记密码：Better Auth 启用 `sendResetPassword`，通过平台 SMTP 发送重置链接；前端改用 `/request-password-reset` 并展示认证库可读原因。
- 变更计划：`external_system` 类型不可放行/执行（本版未接连接器），避免形成永远无法完成的已批准计划与活动槽位占用；Web 按服务端 actions 隐藏不可用动作。
- 幂等作用域：使用实际请求路径与路径中的团队标识，避免同一用户跨团队复用同一个 `Idempotency-Key` 被误判冲突。
- 错误处理：413 归入参数错误；500 日志不再打印原始 error（避免 SQL、绑定参数与内部堆栈进入日志）。
- 外部错误消息：api-client 保留服务端业务消息，Web/CLI 不再统一显示“操作未完成”。

### CLI

- `team list` 按真实 `{ teams, isPlatformAdmin }` 契约输出，修复恒为空列表。
- 新增并按 README 注册 `code branches/tree/file` 与 `project repository commits/commit/pull-requests/pull-request/pull-request-diff`。
- `--json` 下 commander 参数错误输出 JSON；本地配置错误退出码改为 2。
- 补齐 `change list --from/--to` 的 ISO 8601 本地校验、`--all` 的分页汇总（change/delivery）、`platform_pipeline` 必填 workflow、非通过自测结论必填说明、空评论与远端评论仓库校验。
- README 的 `tool issue` / `tool comment` 命令名与实现对齐。

### 流水线 / Agent

- Agent 的 git 子进程环境透传 HTTP(S)/ALL/NO_PROXY，修复企业网络或本机代理下无法检出代码的问题；新增环境白名单测试。
- 新增 `.devops/workflows/platform-smoke.yml`，在本机注册节点上完成一次真实运行：检出 GitHub 提交、生成 `build-info.json`、上传产物 `build-info`（SHA-256 可查），运行状态 `succeeded`。

### Web

- **P0**：新建变更计划增加“服务”选择（部署版本必填），并改为固定标题/底部操作栏；其余类型使用 `external_system` 只记录，不再伪装平台流水线。
- **P0**：忘记密码链路修复（见服务端/前端认证）。
- 页头统一为 flex 布局，修复运维列表/详情与储存桶主操作掉行。
- 晴雨表日期弹窗标签使用 `--muted-foreground`，修复不可见；热力图改为 roving tabindex + 方向键移动，365 个格子只保留一个 Tab 停靠点。
- 弹窗关闭后焦点归还触发元素；移动端抽屉增加遮罩、关闭按钮、焦点移入与 Tab 陷阱。
- 需求/Bug 详情加载与错误态放回右侧详情面板；详情顶部“关闭”改为“返回列表”。
- 提交记录弹窗：行布局、时间本地化，不再显示原始 ISO。
- 环境变量列表、提交记录列表增加统一行布局；移动端代码页 Git 信息条换行、文件浏览器改单栏。
- 技能/模板/凭据搜索：本地受控输入 + 350ms 防抖，修复丢字与逐字请求。
- 个人资料新增显示名称维护与修改密码；已登录访问 /login 直接跳回工作台；移动端登录表单前置到首屏。
- 活动记录补齐开发中、协作人、附件等动作中文标签；Bug 详情展示证据文本与链接；仓库状态显示中文。
- 业务校验错误优先展示服务端具体原因（字段级提示不再被通用文案覆盖）。

## 3. 验证

| 检查 | 结果 |
| --- | --- |
| `pnpm --dir apps/server test` | 117/117 通过 |
| `pnpm --dir apps/server test:db` | 121/121 通过（含新增密码重置、重复邀请用例） |
| `pnpm --dir apps/server typecheck` | 通过 |
| `pnpm --dir apps/web test` | 258/258 通过 |
| `pnpm --dir apps/web build`、`pnpm --dir apps/cli build`、`pnpm --dir apps/pipeline-agent build` | 通过 |
| `pnpm --dir apps/cli test` | 108/108 通过（含新增 code/PR 命令测试） |
| `pnpm --dir apps/pipeline-agent test` | 61/61 通过 |
| `pnpm ui:check` | 通过（96 处存量，0 新增） |
| 浏览器回归 | 见第 4 节截图路径 |
| 流水线 | `platform-smoke` 运行 `succeeded`，产物 `build-info` 可下载 |

## 4. 浏览器回归证据

- 晴雨表日期弹窗标签可见。
- 需求详情「评论/活动/提测历史」三个页签背景 `rgb(249,250,251)`、非选中文字 `rgb(97,102,107)`，可读可点。
- 新建变更计划弹窗服务字段存在，保存按钮在 1000px 视口内（y=885）。
- 环境变量列表行 `display:flex`。
- 移动端 390px：GitHub 外链在视口内；抽屉遮罩与关闭按钮存在；登录邮箱输入框在首屏（y≈156）。
- 截图：`/tmp/browser/verify/*.png`（临时验收文件，不提交）。

## 5. 未完成 / 未验证

- CLI README 中 `delivery`/`change` 的少数 `--all` 语义仍只覆盖列表；未实现 `code` 组之外的更多快捷命令。
- API P2：权限拒绝文案未区分“非成员/角色不足”；Git ref 不存在仍可能映射为 `EXTERNAL_UNAVAILABLE`；viewer 可见全员邮箱、鉴权晚于 schema 校验等按产品口径待确认。
- UI P1/P2 未完成：PR 筛选入 URL、移动端表格滚动提示、凭据配置请求日志弹窗、头像上传、变更详情项目 UUID 展示、全站 document.title。
- 未验证：真实 GitHub 写权限、非本机 Linux 节点、生产部署、外部执行系统连接器。
- 审计报告中其余未修复项保留在对应审计清单，不视为已通过。
