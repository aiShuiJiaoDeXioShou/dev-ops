# 前端开发说明

前端使用 React、TypeScript、Vite、Tailwind CSS 4、React Compiler、React Router Data Mode、TanStack Query 与 shadcn/ui。V0.1 已接入登录/邀请、团队管理、项目、需求、Bug、评论/活动与代码引用页面；系统状态页保留用于排查后端和数据库联通。

## 本地运行与检查

使用 Node.js 24.15.0、pnpm 11.12.0；应用声明自己的依赖，使用根目录工作区和锁文件。在仓库根目录执行：

```bash
nvm use
pnpm install --frozen-lockfile
pnpm prepare:clients
pnpm dev:web
```

默认地址为 http://localhost:5173。请按[根目录说明](../../README.md)启动 PostgreSQL、执行迁移并启动后端；Vite 将同源 `/api` 请求代理至 `http://127.0.0.1:3001`。启动进程可通过 `DEV_OPS_API_TARGET` 指定其他代理目标；本目录 `.env` 也会被 Vite 读取，`.env.example` 提供示例。

| 命令（仓库根目录执行）           | 用途                                      |
| -------------------------------- | ----------------------------------------- |
| `pnpm --dir apps/web lint`       | Oxlint 静态检查                           |
| `pnpm --dir apps/web test`       | Vitest、React Testing Library 与 MSW 测试 |
| `pnpm --dir apps/web test:watch` | 监听测试文件变化                          |
| `pnpm --dir apps/web build`      | TypeScript 检查与生产构建                 |
| `pnpm --dir apps/web check`      | 依次执行 lint、typecheck、test            |
| `pnpm --dir apps/web preview`    | 本地预览构建产物                          |

根目录 `pnpm lint`/`pnpm format:check` 是仓库统一质量门禁。前端测试使用 MSW，不需要后端或数据库在线。

## 路由与页面结构

| 路由                                  | 页面     | 说明                                   |
| ------------------------------------- | -------- | -------------------------------------- |
| `/login`                              | 登录     | 邮箱密码登录，成功后回跳原页面         |
| `/accept-invitation?token=…`          | 接受邀请 | 设置姓名/密码并加入团队                |
| `/forgot-password`、`/reset-password` | 找回密码 | 调用认证库协议端点                     |
| `/projects`                           | 项目列表 | 登录后首页；按当前团队筛选/创建项目    |
| `/projects/:projectId/requirements`   | 需求     | 列表、详情、评论、活动、提测/测试流程  |
| `/projects/:projectId/bugs`           | Bug      | 列表、详情、回归历史、关闭/重开        |
| `/projects/:projectId/settings`       | 项目设置 | 项目资料、Git 连接、仓库关联           |
| `/settings/team`                      | 团队管理 | 管理员管理成员与邀请；无团队时创建团队 |
| `/system/status`                      | 系统状态 | 后端/数据库就绪检查                    |
| `/prototype/*`                        | 交互原型 | 仅开发环境注册，不进入生产构建         |

`RequireAuth` 保护所有业务路由并在布局内提供 `SessionProvider`；未登录跳转 `/login?redirect=…`。当前团队保存在本地存储，切换团队后查询键包含团队/项目范围。页面懒加载并导出 `Component`，加载/渲染失败由路由错误边界兜底。

目录：

- `features/identity`：认证请求、会话上下文、登录/邀请/成员管理。
- `features/projects`、`requirements`、`bugs`、`code`：按功能组织 `api/`、`model/`、`ui/` 与 `public.ts`。
- `features/collaboration`：通用评论与活动时间线。
- `shared/api`：页面使用的 API 单例、QueryClient 与业务错误文案。
- `shared/lib`：Markdown 安全渲染、日期/编号格式化、列表 URL 状态。
- `shared/ui`：加载/失败/空状态与 shadcn 控件。

## 请求、缓存与业务错误

- 业务请求统一使用 [共享 API 客户端](../../packages/api-client/src/index.ts)；页面不手拼 `/api/v1` 地址、不直接解析响应的 `success/code`。
- 响应必须是统一信封；`success:false` 转为 `RequestError`，页面通过 `describeRequestError` 展示安全文案与 `requestId`，不显示服务端原始正文。
- 创建、评论、提测等写操作携带 `Idempotency-Key`；重复提交返回 `IDEMPOTENCY_CONFLICT` 时保留未提交输入并提示刷新。
- 查询 30 秒内视为新鲜，缓存保留 5 分钟；网络/超时/5xx 最多自动重试一次，业务错误、权限错误与契约错误不重试；写操作默认不重试。
- 退出登录调用认证端点并清空 QueryClient；切换团队后列表查询按团队/项目重新取数。
- Markdown 通过 `shared/lib/markdown.tsx` 的 react-markdown + rehype-sanitize 渲染，只允许安全协议，禁止脚本和事件属性。

## UI 与依赖

shadcn/ui 使用 Radix 基础控件和 nova 样式，配置见 [components.json](components.json)。已纳入 Button、Input、Textarea、Select、Dialog、Tabs、Table、Badge、Alert、Card、Sheet 等；主题变量在 [shared/styles/index.css](src/shared/styles/index.css)，`@/` 指向 `src/`。

表单依赖 `react-hook-form`、`zod`、`@hookform/resolvers`；Markdown 依赖 `react-markdown`、`rehype-sanitize`。新增控件仍按需生成并检查差异、补中文 JSDoc 与交互测试，避免覆盖本地主题。

## 验证范围

测试覆盖登录失败与本地校验、路由保护/回跳、项目列表、项目表单校验、需求/Bug 权限与流程对话框校验、代码仓库空状态、Markdown 安全、统一错误/重试、深链接、404、移动导航抽屉与路由错误边界。每个用例独立创建 QueryClient 和路由，MSW 拦截请求并清理处理器。

手工验收仍需按 [quickstart](../specs/001-v01-rd-workflow/quickstart.md) 使用真实后端、邮箱与 Git 资源执行；自动化测试不替代真实 SMTP、GitHub/Gitea 网络与权限验收。
