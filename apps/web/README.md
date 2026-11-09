# 前端开发说明

前端使用 React、TypeScript、Vite、Tailwind CSS 4、React Compiler，已接入 React Router Data Mode、TanStack Query 和 shadcn/ui。当前提供工作台和系统状态页面，尚未实现登录与项目业务流程。整体方向见[技术选型方案](../../docs/technical-selection.md)。

## 本地运行与检查

使用 Node.js 24.15.0、pnpm 11.12.0；应用声明自己的依赖，使用根目录工作区和锁文件。在仓库根目录执行：

```bash
nvm use
pnpm install --frozen-lockfile
pnpm dev:web
```

单独执行本应用检查前先在根目录运行 `pnpm prepare:clients`。默认地址为 http://localhost:5173。按[根目录说明](../../README.md)启动 PostgreSQL、执行迁移并启动后端；Vite 将同源 `/api` 请求代理至 `http://127.0.0.1:3001`。启动进程可通过 `DEV_OPS_API_TARGET` 指定其他代理目标，例如 `DEV_OPS_API_TARGET=http://127.0.0.1:4001 pnpm dev:web`。前端测试使用 MSW，不需要后端或数据库在线。

| 命令（仓库根目录执行） | 用途 |
| --- | --- |
| `pnpm --dir apps/web lint` | Oxlint 静态检查 |
| `pnpm --dir apps/web test` | Vitest、React Testing Library 与 MSW 测试 |
| `pnpm --dir apps/web test:watch` | 监听测试文件变化 |
| `pnpm --dir apps/web build` | TypeScript 检查与生产构建 |
| `pnpm --dir apps/web check` | 依次执行 lint、typecheck、test |
| `pnpm --dir apps/web preview` | 本地预览构建产物 |

`/api` 代理仅在 Vite 开发服务中配置；生产部署和独立构建预览需另外提供 API 同源转发。生产网关应先处理 `/api`，再将前端页面路径回退到 `index.html`，使深链接刷新可用。

## 路由与目录

| 位置 | 职责 |
| --- | --- |
| [main.tsx](src/main.tsx)、[应用 Provider](src/app/providers/application.tsx) | 入口在 React 渲染前创建浏览器路由；App 持有稳定的 QueryClient，组装 Provider |
| [app/router/routes.tsx](src/app/router/routes.tsx) | 嵌套路由、页面懒加载、初始化加载占位及路由错误边界 |
| [app/layouts/app-layout.tsx](src/app/layouts/app-layout.tsx) | 桌面侧栏、移动导航抽屉、导航加载提示及内容出口 |
| [shared/ui/page-state.tsx](src/shared/ui/page-state.tsx) | PageLoading、PageError、EmptyState |
| [shared/ui/controls](src/shared/ui/controls) | 按需纳入的 shadcn/ui 控件 |
| [共享 API 客户端](../../packages/api-client/src/index.ts) | 超时、取消、JSON 解析与安全错误转换 |
| [shared/api/query-client.ts](src/shared/api/query-client.ts) | 统一缓存生命周期与重试策略 |
| [features/system/api/queries.ts](src/features/system/api/queries.ts) | 就绪查询键及查询函数，契约校验由共享客户端完成 |
| [pages](src/pages) | 页面内容；懒加载页面导出 `Component` |
| [test](src/test) | MSW 服务与测试生命周期 |

当前路由为 `/`（工作台）、`/system/status`（系统状态）；未匹配地址显示 404 与返回入口。页面模块加载或渲染失败进入安全兜底页，可重新加载或返回工作台。导航通过 Link/NavLink 完成，浏览器前进后退保留 URL 语义。

新增页面时在路由表注册并复用 AppLayout。页面分别展示加载、失败和空结果；查询失败由页面提供重试，未处理的路由故障由根错误边界兜底。后续需要 loader 预取时复用同一组 Query 定义，避免维护第二份服务端数据缓存。

## 查询与请求约定

工作台和系统状态使用同一查询键 `['system', 'readiness']` 读取 `/api/v1/ready`，验证后端和数据库。数据在 30 秒内视为新鲜，不活跃缓存保留 5 分钟；过期后可因重新挂载、窗口聚焦或网络恢复触发刷新，也可手动检查。状态是最近一次采样，不能代替持续监控。

每次请求超时为 5 秒，并传递 Query 的取消信号；离开最后一个使用该查询的页面后，未完成请求会被取消。网络异常、超时及 HTTP 5xx 最多自动重试一次，间隔 500 毫秒；HTTP 4xx、非法 JSON 和契约错误不自动重试，写操作默认不重试。自动重试会增加总等待时间。

响应先作为 unknown 校验再使用。错误提示保留安全说明、HTTP 状态和可用的 `x-request-id`，不透传原始错误体或堆栈。当前请求层仅实现实际使用的 GET；后续写入按真实契约扩展，成功后失效相关查询。

公共就绪查询不包含身份信息。新增用户、团队或项目查询时，查询键必须包含其资源范围；认证接入时需取消并清理退出用户的缓存。本次未添加认证、缓存持久化、页面保活或全局客户端 store。

## UI 维护

shadcn/ui 使用 Radix 基础控件和 nova 样式，配置见 [components.json](components.json)。已纳入 Button、Card、Alert、Badge、Skeleton、Separator、Sheet；Tailwind 与主题变量统一在 [shared/styles/index.css](src/shared/styles/index.css)，`@/` 指向 `src/`。字体随本地包构建，不依赖外部字体服务。

后续可在仓库根目录按需添加控件，例如：

```bash
pnpm --dir apps/web exec shadcn add input
```

生成后检查差异并补充中文 JSDoc、用户可见文案与交互测试，避免覆盖本地调整。优先使用现有控件；有实际表单页面时再引入 React Hook Form 与 Zod。不要恢复 Vite 模板中未分层的全局样式，以免覆盖 Tailwind 工具类。

## 验证范围

现有自动化测试覆盖首次加载、导航与缓存复用、深链接、404、路由渲染异常、HTTP 与响应契约错误、取消、重试策略及失败恢复。每个测试独立创建路由和 QueryClient，MSW 拦截请求，结束后清理缓存和处理器。

2026-11-09 接入验证已执行 lint、组件测试和生产构建，并通过浏览器检查真实后端联通、深链接刷新、缓存复用、移动端导航、Escape 关闭与焦点恢复。仓库跨应用脚本验证真实 API 代理、深链接响应和 CLI 联通，尚未自动化浏览器操作；登录、业务表单和权限场景随对应功能补充。
