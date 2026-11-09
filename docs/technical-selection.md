# 前后端技术选型与集成方案

**面向项目研发与运维平台，确定前后端组件组合、接入边界和验证要求。**

| 属性 | 内容 |
| --- | --- |
| 状态 | 前端路由、Query 与 shadcn/ui 基础设施已接入；表单、内置 Better Auth 与业务流程仍待实施 |
| 负责人 | 项目维护者；研发负责集成与兼容性验证 |
| 读者 | 项目维护者、前后端开发人员及测试人员 |
| 范围 | 前后端基础组件、数据库访问、认证权限、测试与工程缺口 |
| 关联 | [V0.1 需求](prd/v0.1.md)、[版本规划](prd/release-plan.md)、[后端架构](architecture/server-foundation.md)、[数据库说明](architecture/database.md) |

## 1. 方案摘要与现状依据

建议在现有工程上补齐路由、数据缓存、基础 UI 和内置认证，保留已有后端与数据库组合。选择以标准协议、官方适配、可隔离测试和当前集成成本为依据；库的流行程度或其他项目采用情况不能代替本项目验证。

本方案的目标是让后续业务模块使用一致的导航、请求、表单和权限边界。本文记录选型与接入设计，并随实现更新状态；已接入部分见下表和[前端说明](../apps/web/README.md)。组件选型不确定 PRD 中仍待确认的业务规则。Bot 执行、任务队列、文件存储和生产部署不进入本次基础组件接入范围。

文中状态含义如下：**当前已接入**表示工作区存在对应实现；**推荐接入**表示后续实施方向；**兼容性待验证**表示需要通过指定实验或测试才能采用。代码和测试文件存在，不表示本次已运行检查或功能已经部署。

### 1.1 工程核对依据

以下结论来自 2026-11-09 工作区核对，工程参考提交为 `066101f2ac66c32d4633fcf920a8fc20aaba71e1`，包含此后未提交的前端基础设施接入。本文按工作区内容引用，不将其视为已发布契约。

| 能力 | 当前状态 | 可核对的依据 |
| --- | --- | --- |
| 运行时与依赖管理 | Node.js 固定为 24.15.0；应用分别声明依赖，根工作区统一管理锁文件 | [.nvmrc](../.nvmrc)、[前端依赖](../apps/web/package.json)、[后端依赖](../apps/server/package.json) |
| 前端基础 | 已接入 React、TypeScript、Vite、Tailwind 和 React Compiler，提供响应式工作台和系统状态页 | [应用 Provider](../apps/web/src/app/providers/application.tsx)、[Vite 配置](../apps/web/vite.config.ts)、[样式入口](../apps/web/src/shared/styles/index.css) |
| 路由、查询缓存及 UI 组件 | 已接入 React Router Data Mode、TanStack Query 和首批 shadcn/ui 控件；已有 Vitest、Testing Library、MSW 测试 | [路由](../apps/web/src/app/router/routes.tsx)、[查询配置](../apps/web/src/shared/api/query-client.ts)、[前端依赖与脚本](../apps/web/package.json) |
| 表单 | React Hook Form 与 Zod 尚未接入，等待真实表单需求 | [前端依赖](../apps/web/package.json) |
| 交互原型 | 独立 HTML/CSS/JS 原型，尚未迁入 React | [原型说明](desgin/interactive-prototype-v1/README.md) |
| API 基础 | 已接入 Fastify、TypeBox、配置校验、日志、统一错误和 OpenAPI；模块只有健康检查 | [应用组装](../apps/server/src/bootstrap/create-http-app.ts)、[健康检查](../apps/server/src/modules/health/health.routes.ts)、[错误处理](../apps/server/src/platform/http/errors.ts) |
| 数据库基础 | 已接入 PostgreSQL、Drizzle、pg 连接池；正式迁移仅建立 app schema 与权限，没有业务表 | [连接实现](../apps/server/src/platform/database/client.ts)、[schema](../apps/server/src/bootstrap/database-schema.ts)、[基础迁移](../apps/server/drizzle/0000_initialize_app_schema.sql) |
| 认证、成员与项目权限 | 尚未实现，Better Auth 尚未加入依赖 | [应用组装](../apps/server/src/bootstrap/create-http-app.ts)、[后端依赖](../apps/server/package.json) |
| 后端测试 | 已有接口、配置和真实数据库集成测试文件 | [接口测试](../apps/server/test/http/app.test.ts)、[配置测试](../apps/server/test/config.test.ts)、[数据库测试](../apps/server/test/integration/database.test.ts) |

### 1.2 版本与来源使用方式

已有版本范围以各子项目 `package.json` 为准，实际解析版本以锁文件为准。前端已接入组件的检查方式及执行范围见[前端说明](../apps/web/README.md#验证范围)；认证、表单及尚未安装的其他候选组件仍需完成各自兼容性验证。

外部能力依据于 2026-11-09 核对的官方文档；DSH 源码另外固定到第 5 章的提交。实施时应选择当时受维护的正式版本，核对 peer dependencies、发布说明和迁移要求，再提交对应锁文件。适配器要求升级现有库时，单独评估升级成本，不能为了安装成功而关闭类型检查。

## 2. 前端组件与状态边界

前端继续使用 Vite 单页应用。路由负责 URL 与页面组合，TanStack Query 负责业务服务端数据，表单负责编辑过程，展示组件通过 props 接收结果。这样可以分别测试导航、网络行为与交互。

| 能力 | 推荐组件 | 选择理由 | 集成方式与成本 |
| --- | --- | --- | --- |
| 路由 | React Router Data Mode | 在现有 SPA 中统一嵌套布局、加载及错误边界 | 使用 createBrowserRouter、RouterProvider；维护懒加载、路由错误页及深链接 |
| 数据查询与更新 | @tanstack/react-query | 统一多页面读取同一资源时的缓存和失效 | 应用根部创建 QueryClientProvider；按业务定义查询键和更新后的失效范围 |
| HTTP 请求 | 原生 fetch 的薄封装 | 标准 API 已能满足当前 HTTP 请求需求 | 统一超时、AbortSignal、响应校验和错误转换；不预建通用 SDK 框架 |
| 基础 UI | shadcn/ui + 已有 Tailwind | 延续原型视觉，允许调整控件代码 | 按需纳入组件代码、统一主题变量，维护本地组件及其底层依赖 |
| 表单 | react-hook-form、zod、@hookform/resolvers | 与所选 UI 组合，统一表单值、输入校验和错误展示 | 处理前端提示和服务端字段错误；后端继续执行权威校验 |
| 错误与加载 | Data Router 的 lazy、HydrateFallback、ErrorBoundary；需要独立懒加载组件时使用 React Suspense，局部边界按需评估 [react-error-boundary](https://github.com/bvaughn/react-error-boundary) | 分别处理导航、懒加载与局部渲染故障 | 路由提供初始化占位和导航提示，普通查询显式处理 pending、error 和空结果；维护恢复入口 |
| 页面保活 | React Activity，按需使用 | 复用 React 已有的隐藏状态保留能力 | 只用于有明确状态保留需求的页面或面板，承担隐藏树的内存成本 |
| 跨组件客户端状态 | [Zustand](https://github.com/pmndrs/zustand)，按需引入 | 为实际共享交互提供独立 store，便于隔离测试 | 出现无法由 URL、局部状态或现有上下文承接的共享交互时再添加 |

React Router 的 Data Mode 可在现有 SPA 中使用，无需先迁为全栈框架。路由 loader 若需要预取数据，调用同一组 Query 查询定义，避免再维护一套业务数据缓存。[路由模式说明](https://reactrouter.com/start/modes)

> **Why & What - Tailwind 与 shadcn/ui**
>
> **选择：** 延续现有样式技术，按需引入可编辑的基础组件代码。
>
> **理由：** 现有原型需要定制工作区、详情抽屉和 Bot 界面，组件代码可随产品视觉调整。官方提供现有 Vite 工程接入方式及 React Hook Form、Zod 组合示例。
>
> **备选：** Ant Design 提供现成的业务组件和 Form，适合接受其交互与视觉约定的管理后台；当前优先保持原型的定制空间。
>
> **代价与退路：** 团队负责本地组件升级、可访问性和复杂表格组合。若后续转为标准后台，可重新评估 Ant Design，并按业务模块迁移，避免两套基础控件长期混用。

依据：[shadcn/ui 的 Vite 接入](https://ui.shadcn.com/docs/installation/vite)、[表单组合](https://ui.shadcn.com/docs/forms/react-hook-form)、[Ant Design 组件定位](https://ant.design/docs/react/introduce)。

### 2.1 接入位置与通用组件

当前 `apps/web/src/app/` 组装路由、Provider 和布局；`shared/api/` 初始化共享请求客户端与 Query，`shared/ui/` 放置基础控件；`pages/` 组合工作台与系统状态页，`features/system/` 持有就绪查询和状态卡片，通过 public.ts 对外提供。后续业务页面与查询按实际模块组织，不生成空壳目录。

已实现的 AppLayout 提供桌面导航、移动抽屉和内容出口；NotFoundPage 处理未匹配路径，PageError 提供重试入口，路由错误页提供重新加载与返回入口。项目布局与 RequireAuth 尚未实现；后续项目布局从路由参数取得当前项目，RequireAuth 在会话确认期间显示加载状态，未登录时进入登录入口。客户端导航控制不能代替服务端鉴权。

已纳入 Button、Card、Alert、Badge、Skeleton、Separator、Sheet，并实现通用加载、错误和空状态。Input、Select、Dialog、Tabs、确认对话框及提交反馈按后续真实页面需求补充。抽屉和弹窗需支持键盘关闭、焦点约束与关闭后焦点恢复，再按需要评估复杂表格或虚拟列表。

当前 GET 请求层接收调用方取消信号，并结合 5 秒超时停止请求；响应先作为 unknown 校验，再供页面使用。失败保留安全提示、HTTP 状态和可用的 x-request-id，不展示原始错误体或堆栈。共享客户端按契约校验错误响应，保留合法的来源代码和校验结果，用户提示由客户端生成。TypeBox/OpenAPI 继续定义业务接口，前端 Zod 只补充表单交互约束，不自行决定权限或状态流转。当前从 OpenAPI 生成共享客户端类型及独立响应校验器，Web 和 CLI 使用同一来源。

### 2.2 数据缓存、保活与持久化

> **Why & What - TanStack Query 数据缓存**
>
> **选择：** 将业务接口数据交给 Query 管理，更新操作使用 mutation，并更新或失效相关查询。
>
> **理由：** 项目、需求和 Bug 会被多个页面读取，需要一致的请求去重、失效和错误状态。用局部 useEffect 或全局 store 手工维护时，需要自行实现这些规则。
>
> **备选：** 路由 loader 可负责页面数据加载，但跨页面共享、更新后的失效和轮询仍需明确方案；当前让它复用 Query。
>
> **代价与退路：** 查询键和刷新策略需要维护，缓存不能代替服务端授权。若只剩独立静态页面，可移除对应 Query 使用，保留请求函数。

查询键包含实际隔离维度，例如身份、团队、项目、筛选和分页；示意为 `[用户标识, 团队标识, 'issues', 项目标识, 查询条件]`，只包含标识，不包含令牌。创建或修改事项成功后，失效相关详情、列表及计数；失败时保留可重试的错误，不伪装为成功。

staleTime 决定数据多久被视为新鲜，gcTime 决定不活跃查询保留多久，二者不等同。Query 默认将缓存视为过期，并可能在挂载、重新聚焦或重连时刷新。[Query 默认行为](https://tanstack.com/query/latest/docs/framework/react/guides/important-defaults) 当前应用配置为 30 秒新鲜期、5 分钟回收期，网络、超时或 HTTP 5xx 最多重试一次，4xx 与契约错误不自动重试，写操作默认不重试。后续逐类确定时效，实时状态与普通列表分别配置刷新策略；当前没有业务 mutation、身份隔离或持久化缓存。

| 状态内容 | 权威位置 | 保留与清理方式 |
| --- | --- | --- |
| 项目、筛选、排序、分页及可分享的详情选择 | URL 路径与搜索参数 | 刷新及前进后退恢复；敏感正文不写入 URL |
| 项目、需求、Bug 等服务端数据 | Query 缓存 | 身份和资源范围隔离；退出、身份切换或权限拒绝时清理受影响数据 |
| 表单值、校验错误、尚未提交的编辑 | 表单与局部 state | 按页面生命周期保留；跨页面或刷新恢复另行定义草稿需求 |
| 主题和侧栏偏好 | 有限的浏览器持久化 | 只保存非敏感偏好；用户专属偏好按身份区分 |
| 需要返回时保留的局部 UI | 保持挂载的 Activity 边界 | 仅在有明确需求时保活，并在身份或权限变化时销毁 |

Activity 隐藏时保留状态和 DOM、清理 Effects，显示时重新建立 Effects。卸载边界或刷新浏览器仍会失去这些状态；直接包住一个随路由切换被卸载的 Outlet，不能自动实现路由缓存。保活页面必须限制数量，并验证定时器、订阅和请求取消行为。[React Activity](https://react.dev/reference/react/Activity)

认证会话由 Better Auth 客户端提供，不再复制为另一份长期全局状态。退出或切换身份时，先取消未完成的业务查询，再清理 Query、保活页面和身份相关草稿，避免旧请求回写。对其他标签页的退出通知补充同步测试。私有仓库缓存的读取仍受[来源授权约束](architecture/server-foundation.md#41-代码平台-api-接入)。

## 3. 后端与数据库集成

建议延续现有模块化单体，按业务增加路由、schema，以及实际需要的 service 和 repository。路由转换 HTTP 输入输出，service 接收可替换依赖并执行规则，repository 负责查询和事务；避免为每个模块建立没有职责的层。

> **Why & What - 保留 Fastify 与 TypeBox**
>
> **选择：** 沿用现有应用组装、配置校验和接口契约体系。
>
> **理由：** 工程已有可供扩展的插件注册、响应 schema 和 inject 测试入口，能够隔离 HTTP 与业务逻辑。
>
> **备选：** NestJS 提供统一模块与依赖注入约定，适合需要框架强约束的团队；目前没有足以抵消迁移成本的需求。
>
> **代价与退路：** 研发负责保持模块边界；独立业务函数可在未来框架调整时复用。

运行与接口约定由[后端说明](../apps/server/README.md)维护。业务请求和响应继续使用 TypeBox，从 schema 推导类型并生成 OpenAPI；返回数据按响应字段筛选。错误处理统一关联请求标识，日志记录一次并脱敏。配置集中在 `apps/server/src/platform/config/` 加载，新增变量同步示例和说明，业务模块不直接读取环境变量。

> **Why & What - 保留 PostgreSQL、Drizzle 与 pg**
>
> **选择：** 延续现有数据库、连接池与版本化 SQL 迁移。
>
> **理由：** 当前组合已接入配置、超时、迁移账号及测试，适合继续按业务增加关系模型。Drizzle 的应用层 relations 不会隐式建立数据库外键，可配合项目约定使用。
>
> **备选：** Prisma 提供生成式类型客户端和迁移工具，适合希望统一 ORM 工作流的项目；切换需要重新验证查询、迁移、事务及认证适配。直接使用 pg 则需要维护更多 SQL 和结果转换。
>
> **代价与退路：** Drizzle 仍要求理解 SQL、审查迁移并管理并发一致性。复杂查询可在明确 repository 内使用参数化 SQL，不必为此整体迁移 ORM。

依据：[Drizzle relations 与外键边界](https://orm.drizzle.team/docs/relations)、[Prisma ORM](https://www.prisma.io/docs/orm)。数据库建模规则以 [AGENTS.md](../AGENTS.md#postgresql-数据库规范)为准，执行方式以[数据库说明](architecture/database.md)为准。

新增业务 repository 使用现有应用 Drizzle 实例，认证适配器也复用该实例，避免每个模块私建连接池。必须共同成功的写入在同一短事务内执行，外部 HTTP 调用放在事务外。无外键关联的新增与删除需锁定同一父记录或采用等效并发方案，检查更新行数，并用真实数据库测试竞态。

schema 变更通过 Drizzle Kit 生成并审查 SQL，再由独立迁移入口执行。应用启动不自动改表；新版本要验证空库与已有数据升级。新增组件不得破坏应用关闭释放连接、失败迁移回滚和迁移互斥行为，生产账号继续与迁移账号分离。

## 4. Better Auth 认证与业务权限

Better Auth 是内置认证主方案，负责会话和所启用的登录能力；团队成员资格、角色、资源归属与状态操作由平台业务模块负责。选定认证组件不表示登录入口、开放注册、邀请或账号恢复的产品规则已确定。

> **Why & What - 内置 Better Auth**
>
> **选择：** 通过官方 Fastify 集成与 Drizzle 适配接入 Better Auth，先使用数据库会话。
>
> **理由：** 符合应用加 PostgreSQL 的部署目标，官方提供认证 handler、React 客户端和测试辅助能力，减少自行实现认证协议的范围。
>
> **备选：** 现有 OIDC 服务或 Keycloak 适合集中账号管理、跨应用统一身份，但独立部署身份系统会增加运维工作；保留为后续需求选项。
>
> **代价与退路：** 需要维护认证 schema、Cookie、会话撤销和库升级。若第 4.2 节验证失败，先停止业务接入并评估适配或独立身份方案，不放宽数据库规范，也不自行拼装密码和令牌协议。

依据：[Fastify 集成](https://better-auth.com/docs/integrations/fastify)、[Drizzle 适配](https://better-auth.com/docs/adapters/drizzle)、[Keycloak OIDC](https://www.keycloak.org/securing-apps/oidc-layers)。这些资料说明接入能力，不构成本项目兼容性验证结果。

### 4.1 模块、协议与会话接入

建议在 `apps/server/src/modules/identity/` 创建认证实例工厂和 Fastify 插件，由应用组装入口传入已校验配置及 Drizzle 实例。工厂不监听端口，不持有进程全局可变实例，测试可使用独立数据库和配置创建。按已核对文档，拟新增 better-auth、@better-auth/drizzle-adapter，React 客户端使用 better-auth/react；实施定版时复核该版本的包名与导出。

统一认证基础路径为 `/api/v1/auth`，服务端 basePath、客户端 basePath 和路由挂载保持一致。baseURL 使用配置提供的对外 origin，避免其中额外路径覆盖 basePath。浏览器通过现有 `/api` 开发代理和部署网关同源访问；前端使用 Better Auth React 客户端，原始令牌不写入 localStorage。[配置说明](https://better-auth.com/docs/reference/options)

handler 桥接需保留方法、请求头和请求体，并转发状态、响应内容、重定向与每一条 Set-Cookie。验证 Fastify 解析后的请求与库需要的 Web Request 之间的转换；禁止以对象合并或逗号拼接破坏多个 Cookie。认证端点保留库协议，不套用业务错误包装，平台业务接口继续使用既有成功和错误约定。对实际启用的认证端点补充对应 TypeBox schema 与 OpenAPI 描述，并验证序列化不会裁剪认证必需字段。

建议新增服务端配置 AUTH_BASE_URL、AUTH_SECRET、AUTH_TRUSTED_ORIGINS，分别表示对外 origin、服务端认证密钥和浏览器来源白名单；它们是拟新增变量，当前配置尚不支持。实现时明确格式及启动校验，更新 `.env.example` 与后端说明，密钥仅由服务端环境注入。生产启用 HTTPS 与安全 Cookie，来源白名单包含真实浏览器访问 origin，保留库的来源与 CSRF 防护，不因开发代理而关闭防护。[Cookie 说明](https://better-auth.com/docs/concepts/cookies)

业务接口每次读取有效会话及当前成员状态，不将 Cookie 或前端缓存中的角色视为长期权威值。初期不启用会话 Cookie 数据缓存和次级缓存，先验证退出、撤销及停用后的访问行为；以后若启用缓存，另行定义撤销时效。会话时长和恢复策略由项目维护者确定，不能无审查继承库默认值。[会话管理](https://better-auth.com/docs/concepts/session-management)

### 4.2 数据库兼容性验证

认证接入前先在隔离 PostgreSQL 中做最小实验：定义认证 schema、执行迁移、创建测试身份、建立和撤销会话、调用受保护测试接口。实验固定库与适配器版本，并记录生成 SQL、适配配置和可重复测试；实验通过前不宣称认证可用。

| 检查项 | 计划处理方式 | 通过标准 |
| --- | --- | --- |
| schema、表与字段命名 | 显式映射库模型到 app schema 下的小写 snake_case 单数表名 | 适配器读写正确，不因名字冲突落入 public schema |
| 外键和级联 | 审查生成模型与 SQL，移除数据库外键声明；验证库级删除和关联处理 | 数据库目录无外键，SQL 无级联操作；并发注册、会话创建及删除不遗留无效关联 |
| 审计字段与注释 | 按每张表核对 created_at、updated_at、更新路径及中文表列注释 | 创建和更新均维护审计值；额外必填字段不会导致库写入失败 |
| 时间类型 | 时间点映射为 timestamptz，核对适配器日期转换 | UTC 与非 UTC 测试会话读取同一时间点，会话到期判断一致 |
| ID 策略 | 首次建模统一选择并验证库支持的生成策略及映射 | 认证与业务关联类型一致；bigint 不经 Number 转换，API 按字符串传输 |
| 迁移与权限 | 认证结构交给 Drizzle 版本化迁移管理，继续使用独立迁移账号 | 空库、增量升级及已有数据保留通过；应用账号不能改表 |
| 事务与撤销 | 验证适配器多步写入、失败回滚和无外键一致性 | 数据库失败不会留下可用的半完成账号或会话，撤销后旧会话不能调用业务接口 |

Better Auth 提供表字段映射及 schema 生成能力；使用 Drizzle 时，应通过 ORM 管理迁移。生成结果只是建模输入，不能直接作为项目合规结果。日期列也需显式核对时区设置。[数据库与字段映射](https://better-auth.com/docs/concepts/database)、[适配器日期列](https://better-auth.com/docs/adapters/drizzle#date-columns)

应用层 soft relations 可以保留查询关系，但不能替代无外键下的完整性控制。若库的写路径无法纳入必要的事务或并发控制，研发应记录失败场景和改造成本，由项目维护者决定后续方向，不能只删掉外键后继续交付。

### 4.3 身份与业务权限

权限链路建议为“有效会话 → 正常团队成员 → 当前角色 → 资源归属与可见性 → 操作前置条件”。管理员、开发者、浏览者沿用既有定义；研发负责人和测试负责人表示业务责任，不自动成为新增角色。

平台成员和项目权限由自己的业务记录维护。初期不直接启用 Better Auth 组织或管理插件作为第二套角色权威来源，后续确需引入时先核对映射与状态同步。GitHub/Gitea 授权独立于平台登录，登录账号不能自动取得私有仓库权限。

账号来源、邀请、恢复及私有内容共享规则继续由项目维护者确认，见 [V0.1 第 7.1 节](prd/v0.1.md#71-身份权限和业务流程)。新增组件不会将其中的建议默认转为确认结果；本方案不改写 PRD。

## 5. DeepSeek Harness 的参考边界

DSH 适合参考工作台布局、流式输出和测试组织。[仓库说明](https://github.com/deepseek-ai/deepseek-harness/blob/fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159/README.md#developer-preview)将其标为开发者预览，提示存在兼容性破坏变更；[包说明](https://github.com/deepseek-ai/deepseek-harness/blob/fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159/packages/README.md)也明确公共 API 仍处于稳定前阶段。不能据此认定它的全部组件适合作为本平台的长期依赖。

本章固定核对官方仓库提交 [fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159](https://github.com/deepseek-ai/deepseek-harness/commit/fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159)。表内依赖组合来自源码与包声明，本次未运行 DSH。

| 范围 | 官方源码可见的组合 | 本项目采用方式 |
| --- | --- | --- |
| Web 基础 | Web 包声明 React、TypeScript、Vite，并依赖自有客户端模块，见 [Web package.json](https://github.com/deepseek-ai/deepseek-harness/blob/fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159/apps/web/package.json) | 保留现有基础，不跟随其依赖版本调整 |
| UI 与面板 | 自有 primitives、renderer、slots、layout 和 dockkit，见[客户端模块图](https://github.com/deepseek-ai/deepseek-harness/blob/fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159/packages/client/README.md) | 参考展示、业务状态和布局分离；拟使用通用库构建所需控件 |
| 状态存储 | 自有 store 引擎使用 Zustand vanilla、Immer，见 [store 实现](https://github.com/deepseek-ai/deepseek-harness/blob/fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159/packages/client/store/src/index.ts)；[renderer](https://github.com/deepseek-ai/deepseek-harness/blob/fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159/packages/client/ui-renderer/package.json)使用 use-sync-external-store | 按需直接使用 Zustand，不预建插件状态引擎 |
| 内容渲染 | micromark/mdast、Shiki、KaTeX、diff、anser，见 [primitives 依赖](https://github.com/deepseek-ai/deepseek-harness/blob/fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159/packages/client/ui-primitives/package.json) | 后续 Markdown、代码、差异或终端场景分别评估，首批不全部安装 |
| 运行时与通信 | Cordis 插件体系及 Typert RPC，见[包职责图](https://github.com/deepseek-ai/deepseek-harness/blob/fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159/packages/README.md) | 参考能力边界，业务 API 继续使用 Fastify REST/OpenAPI |
| 持久化 | 会话使用 JSONL；其他数据有 JSON、SQLite 后端，见[会话](https://github.com/deepseek-ai/deepseek-harness/blob/fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159/packages/session/README.md)与[存储](https://github.com/deepseek-ai/deepseek-harness/blob/fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159/packages/storage/README.md) | 多用户业务继续使用 PostgreSQL，运行记录的持久化后续单独设计 |
| 测试 | 根配置包含 Vitest、React Testing Library，Web 配置包含 Playwright，见[根配置](https://github.com/deepseek-ai/deepseek-harness/blob/fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159/package.json)及上方 Web 配置 | 采用分层测试、隔离夹具和可重复执行方式，不照搬构建编排 |

DSH 的[本地凭据能力](https://github.com/deepseek-ai/deepseek-harness/blob/fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159/packages/credentials/README.md)负责秘密值存取及获取凭据的授权流程，本项目仍需单独设计团队成员、项目授权和平台会话撤销。依赖清单只证明选用情况，稳定性与适用性仍由第 6 章测试和实际运行反馈验证。

## 6. 测试与验收方案

测试应验证用户和客户端可观察的结果，并隔离数据库、会话和 QueryClient。现有后端测试继续保留，前端新增测试工具；组件 mock 不能代替真实数据库约束、Cookie 或权限验证。

| 层次 | 推荐工具与隔离方式 | 验收场景 |
| --- | --- | --- |
| 前端单元与组件 | Vitest、React Testing Library、user-event；每个测试使用独立 Provider 与 QueryClient | 字段校验、提交错误、键盘操作、弹窗焦点、加载与空状态；渲染错误可恢复 |
| 请求与缓存 | MSW 在网络边界模拟接口；控制时间，关闭测试中的自动重试并清理缓存 | 超时与取消、非法响应、相同查询去重、更新后失效、切换用户后旧请求不能回写 |
| 后端业务与接口 | 保留 Node test runner 和 app.inject；通过参数替换外部依赖 | TypeBox 输入输出、错误隔离、未登录、只读角色写入、跨团队及跨项目访问拒绝 |
| 认证集成 | Better Auth 实例、真实 PostgreSQL 与 inject；独立测试配置 | 登录成功及失败、到期、退出和撤销、多个 Set-Cookie、来源校验、成员停用及角色改变后再访问 |
| 数据库 | 延续独立测试库；CI 按需使用 Testcontainers 启动同主版本 PostgreSQL | 空库、已有数据升级、失败迁移回滚、唯一约束、无外键关联竞态、并发更新和连接释放 |
| 端到端 | Playwright 启动前后端及隔离测试库，使用独立浏览器上下文 | 登录后进入项目、创建编辑事项、详情返回保留筛选、刷新深链接、退出及另一用户访问隔离 |

工具能力依据：[Vitest](https://vitest.dev/guide/)、[React Testing Library](https://testing-library.com/docs/react-testing-library/intro/)、[user-event](https://testing-library.com/docs/user-event/intro/)、[MSW](https://mswjs.io/docs/)、[Fastify 测试](https://fastify.dev/docs/latest/Guides/Testing/)、[Playwright](https://playwright.dev/docs/intro)、[Testcontainers PostgreSQL](https://node.testcontainers.org/modules/postgresql/)。

Better Auth test-utils 仅在独立测试配置使用，可辅助创建用户和会话。登录协议、Cookie 和退出流程至少保留真实 handler 测试，不能全部通过注入身份跳过。测试配置和辅助能力不得进入生产认证实例。[测试辅助工具](https://better-auth.com/docs/plugins/test-utils)

现有数据库测试限制为本机 Compose 环境，Testcontainers 不能直接替换连接字符串后复用全部用例。接入 CI 容器时，应先建立同等的应用和迁移角色、授权及随机测试库，再通过受控测试配置支持动态端口，继续限制目标为隔离测试实例。容器启动失败要报告失败，测试结束关闭连接并销毁资源；不使用 SQLite 替代 PostgreSQL 并发和类型验证。

### 6.1 检查命令与执行状态

下列应用命令用于局部检查；首次运行前先在根目录执行 `pnpm prepare:clients`。完整工程检查使用根目录 `pnpm check`，包含契约生成、全部构建、依赖检查和跨应用联通；真实数据库验证使用 `pnpm test:db`。

| 命令（仓库根目录执行） | 覆盖内容 | 接入后的补充要求 |
| --- | --- | --- |
| `pnpm --dir apps/web lint` | 前端静态检查 | 包含新组件与测试文件 |
| `pnpm --dir apps/web test` | Vitest、Testing Library、MSW | 按页面补充表单、身份隔离及更新失效测试 |
| `pnpm --dir apps/web check` | 前端 lint、test、build | 持续检查入口 |
| `pnpm --dir apps/web build` | 前端类型检查与构建 | 验证路由、表单和认证客户端类型 |
| `pnpm --dir apps/server check` | 后端类型、静态与非数据库测试 | 补充权限和认证协议的适当用例 |
| `pnpm --dir apps/server build` | 后端生产构建 | 验证认证与适配器的 ESM 和类型兼容性 |
| `pnpm --dir apps/server test:db` | 真实数据库集成测试 | 增加认证迁移、会话、约束与关联竞态 |

前端组件测试已建立，尚未配置仓库内的 Playwright 端到端与 CI 容器脚本。后续新增相应脚本并接入持续检查，不将未定义的命令列为可执行步骤。认证、表单、业务写入及数据库兼容实验仍按后续实施范围验证。

## 7. 待补齐内容与实施顺序

先完成前端基础设施和认证兼容实验，再实现身份权限与首个业务流程。以真实接口和数据作为验收依据，原型中的按钮、角色切换和演示结果不代表功能可用。

| 顺序与工作项 | 当前状态 | 建议接入位置 | 前置条件 | 完成标准 |
| --- | --- | --- | --- | --- |
| 1. 路由与应用布局 | 基础已完成：嵌套布局、两页、懒加载、404、错误页和移动导航 | 前端 app、业务页面 | 业务导航仍需按需求扩展 | 嵌套布局、404、错误页、刷新和前进后退均可操作 |
| 1. UI 与表单基础 | 基础 UI 与状态组件已接入；业务表单未实现 | shared/ui、表单页面 | 确认主题及实际字段 | 首批控件、键盘与焦点行为可测试，表单能展示服务端失败 |
| 1. 请求与缓存 | 薄 GET 层、Query Provider 和真实就绪查询已接入 | lib、业务查询定义 | 后续业务 API 契约 | 超时取消、数据校验、身份隔离键及更新失效通过测试；后两项待业务接入 |
| 1. 前端测试环境 | Vitest、Testing Library、MSW 及检查脚本已接入 | 前端测试配置与夹具 | 随页面扩充用例 | 测试可在无生产服务时执行 |
| 2. 认证与数据库实验 | Better Auth 尚未接入 | 后端 auth、config、db 与迁移 | 选定受维护版本；完成第 4.2 节设计 | 每项兼容条件有实际证据，空库和升级均可运行 |
| 3. 身份与权限 | 无业务身份和权限模块 | auth、成员及业务 service | 维护者确认登录、邀请、恢复和可见范围 | 真实会话、成员状态与角色生效；越权、撤销及并发管理员保护通过 |
| 3. 首个业务流程 | 无业务表和真实 React 页面 | 项目、需求或 Bug 模块 | 权限、状态和字段规则确定 | 从页面提交到 API 和持久化可追溯，刷新后数据一致 |
| 3. 端到端与 CI | 未配置本文测试组合 | Playwright、隔离数据库与 CI 配置 | 可重复启动前后端和认证 | 首个流程、登录退出及身份隔离能重复验证 |
| 后续能力 | 尚未接入 | 按业务增加 worker、事件或存储模块 | 版本规划确认 Bot、任务、实时通信或文件需求 | 分项定义实际接口、失败恢复及验收，不预建插件体系 |

接入顺序用于安排工程依赖，不改变[版本规划](prd/release-plan.md)的产品范围。Git 关联、提测与回归等首版能力继续按该规划推进，首个流程通过不等于 V0.1 全部交付。

### 7.1 待决策事项与剩余成本

| 待确认项 | 负责人 | 确认时点与影响 |
| --- | --- | --- |
| 登录入口、注册限制、邀请、恢复和会话时长 | 项目维护者 | 身份模块实现前；参考 PRD Q01、Q02，决定启用哪些认证能力及验收 |
| 团队和项目可见范围、私有仓库共享 | 项目维护者 | 业务权限与 Git 接入前；参考 PRD Q03、Q12、Q13，决定服务端授权和缓存策略 |
| 认证 ID、字段映射和事务兼容性 | 研发提出验证结果，项目维护者确定可接受成本 | 认证业务接入前；验证失败时不能放宽数据库规范 |
| 新组件定版、升级与部署配置 | 研发 | 依赖安装前核对运行时和 peer dependencies；部署前确认网关、Cookie 与来源 |

shadcn/ui 的本地代码、认证库升级和数据库迁移都需要持续维护。引入这些组件不会消除表单业务规则、无外键一致性或授权撤销设计；工作区共用锁文件，接口类型与运行时校验由后端契约生成；应用和工程工具的依赖兼容性需分别验证。

实施中若遇到适配器限制，应保留失败证据并修订对应接入设计。不能以关闭校验、吞掉异常、绕过权限或返回演示数据满足验收；未执行的测试和未支持的能力继续显式标记。
