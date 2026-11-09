# identity 模块

- 职责：账号、会话、团队、成员、邀请与权限上下文
- 数据归属：user/session/account/verification、platform_admin、team、team_member、invitation
- 计划任务：T014–T037
- 公开边界：通过 public.ts 提供当前会话、团队成员和角色校验；不导出 schema 与 repository；其他模块只能通过本目录 `public.ts` 调用。

当前仅初始化目录；分层文件按实际功能添加，不预建空壳 service/repository。整体边界见[目标架构](../../../../docs/architecture/system-design.md#5-server-结构与职责)与[任务清单](../../../../specs/001-v01-rd-workflow/tasks.md)。

## Better Auth 兼容性实验（2026-11-10）

- 版本：`better-auth` 与 `@better-auth/drizzle-adapter` 1.7.18，PostgreSQL 18。
- 结论：通过。`user`、`session`、`account`、`verification` 使用 `app` schema 的 snake_case 列；Drizzle 表属性名与 Better Auth `fields` 映射一致；主键为 UUID，无数据库外键。
- 已验证：服务端 `signUpEmail` 创建用户；HTTP `sign-in/email` 返回 HttpOnly Cookie；`get-session` 可读取会话；`sign-out` 后旧 Cookie 无法读取会话；隔离测试库无外键。
- 限制：V0.1 不开放浏览器 `/auth/sign-up/*`，注册仅由邀请接受/root 种子在服务端内部调用；未启用 Better Auth organization 插件，也暂未启用 Cookie 会话缓存，保持停用与撤销即时生效。
- 测试：`apps/server/test/integration/identity-auth.test.ts`；真实数据库运行 `pnpm --dir apps/server test:db`。

## 团队、成员与邀请（2026-11-10）

- 表：`team`、`team_member`、`invitation`，0003 迁移已补中文注释。
- 服务：root 创建团队并邀请管理员；管理员邀请/重发/撤销；接受邀请创建账号与成员关系；成员角色/停用；最后一位正常管理员保护；跨团队访问校验。
- 路由：`/platform/teams`、`/me/teams`、`/teams/:teamId/members`、`/teams/:teamId/invitations`、`/invitations/:token`、`/invitations/:token/accept` 等，全部 HTTP 200 信封。
- 邮件：SMTP 适配器发真实邀请链接；测试使用 FakeMailer。
- 测试：`test/http/identity.test.ts`、`test/integration/identity-teams.test.ts`。
