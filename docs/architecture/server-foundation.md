# 后端技术选型规划

**范围：项目开发平台的 TypeScript API 基础工程与后续基础设施选择。**

| 属性 | 内容 |
| --- | --- |
| 状态 | API 基础工程与 PostgreSQL、Drizzle 已接入；GitHub／Gitea API 接入及私有仓库支持已确定、尚未实现；平台登录认证及任务系统为建议 |
| 负责人 | 项目维护者 |
| 读者 | 平台开发者 |
| 关联 | [运行与扩展说明](../../apps/server/README.md)、[前后端技术选型与集成方案](../technical-selection.md) |

## 1. 方案摘要

基础工程采用 Node.js、Fastify 和 TypeScript，以单个进程部署，按业务模块划分代码。接口使用 REST 和 OpenAPI；TypeBox schema 同时参与类型推导、参数校验和响应定义。

数据库采用 PostgreSQL 18、Drizzle ORM 和 `pg` 连接池。基础迁移创建 `app` schema 和访问权限，业务实体按具体功能需求建模。应用要求数据库连接配置，数据库不可用时存活接口仍返回成功，就绪接口返回 503。

目标是支持前后端独立开发，并提供可验证的接口边界。当前范围不包含业务功能、登录流程、云部署和跨服务通信。

代码平台接入的已确定方向见第 4.1 节，产品范围以[项目需求第 4、6、11 章](../prd/mvp.md)为准；该选择不表示已实现真实仓库连接。

## 2. 已核实的工程基础

工程参考提交为 `640350a8767a9f82921b6cd3261d71389e07aa27`，以下内容按工作区实现与测试文件核对。部分需求和说明包含未提交修改；测试文件存在不表示本次已运行验证。

| 内容 | 状态 | 依据 |
| --- | --- | --- |
| React、TypeScript、Vite 前端 | 已有 | [前端依赖](../../apps/web/package.json) |
| 后端运行时和依赖版本 | 已声明版本与锁文件 | [package.json](../../apps/server/package.json)、[锁文件](../../pnpm-lock.yaml) |
| 环境校验、日志、错误响应、文档、健康检查 | 已实现 | [应用入口](../../apps/server/src/bootstrap/create-http-app.ts)、[配置](../../apps/server/src/platform/config/env.ts) |
| 参数校验、响应序列化、错误隔离、文档开关 | 已有测试用例 | [接口测试](../../apps/server/test/http/app.test.ts)、[配置测试](../../apps/server/test/config.test.ts) |
| PostgreSQL、Drizzle、迁移与就绪探测 | 已接入 | [数据访问](../../apps/server/src/platform/database/client.ts)、[数据库说明](database.md) |
| 登录、任务队列 | 尚未接入 | [应用入口](../../apps/server/src/bootstrap/create-http-app.ts)、[依赖](../../apps/server/package.json) |
| GitHub／Gitea API、私有仓库授权与同步 | 已确定方向，尚未接入 | [应用入口](../../apps/server/src/bootstrap/create-http-app.ts)、[依赖](../../apps/server/package.json)、[项目需求](../prd/mvp.md) |

## 3. 框架与接口契约

> **Why & What - Fastify 模块化单体**
>
> **选择：** 单个 Fastify 服务，通过插件注册业务模块。
>
> **理由：** 当前业务边界尚未明确，普通函数与显式依赖便于调整模块。类型提供器支持从 schema 推导接口类型，见 [Fastify 官方说明](https://fastify.dev/docs/latest/Reference/Type-Providers/)。
>
> **备选：** [NestJS](https://docs.nestjs.com/) 提供模块、控制器和依赖注入约定，适合希望框架统一团队组织方式的项目。当前先使用 Fastify，减少需要预先确定的框架结构。
>
> **代价与退路：** 团队需要自行维护模块边界。若后续采用 NestJS，可保留独立于 HTTP 的业务函数与 repository，重新接入控制器。

> **Why & What - REST 与 OpenAPI**
>
> **选择：** HTTP JSON 接口使用 TypeBox schema，并由 [Swagger 插件](https://github.com/fastify/fastify-swagger) 生成 OpenAPI 文档。
>
> **理由：** 独立接口契约方便浏览器以外的客户端调用，并为共享 API 客户端生成类型和校验器。
>
> **备选：** 直接共享 TypeScript 接口可以减少生成步骤，但无法独立承担运行时校验；当前用 schema 统一这两类约束。
>
> **代价与退路：** 开发者需要维护请求与响应 schema。前端暂时手写调用，接口数量增长后再引入 OpenAPI 客户端生成。

日志采用 Fastify 提供的 Pino 集成；测试采用 Node test runner 和 `app.inject()`。应用构建与端口监听分别放在不同入口，测试可以直接创建应用。该测试方式见 [Fastify 测试指南](https://fastify.dev/docs/latest/Guides/Testing/)。

## 4. 持久化与后续依赖

> **Why & What - PostgreSQL 与 Drizzle**
>
> **选择：** 数据库使用 PostgreSQL 18、Drizzle ORM 和 `pg` 驱动，以 Drizzle Kit 生成迁移，再由独立命令执行。建模与迁移遵守[项目规范](../../AGENTS.md)。
>
> **理由：** 如果平台包含用户、项目、成员和任务等关联实体，关系模型便于表达归属关系。Drizzle 提供 PostgreSQL 驱动集成，见[官方文档](https://orm.drizzle.team/docs/get-started-postgresql)。实体仍是规划假设。
>
> **ORM 备选：** 使用 `pg` 编写参数化 SQL 可以减少 ORM 抽象，但需要自行维护结果类型和迁移工具。
>
> **代价：** PostgreSQL 需要实例、备份和迁移管理。数据库访问集中在 repository 中；CLI 通过后端 API 访问业务资源。

开发环境由 Docker Compose 提供独立 PostgreSQL 实例和数据卷。应用账号只读写业务数据，迁移账号负责结构变更；应用不会自动运行迁移。数据库集成测试创建临时数据库，覆盖空库初始化、迁移重复执行、权限、事务回滚与连接回收。命令、配置与部署约束统一维护在[数据库说明](database.md)。

其他依赖按实际需求引入：

| 能力 | 建议方向 | 接入条件 |
| --- | --- | --- |
| 登录与权限 | 内置认证推荐、权限边界及 OIDC 备选见[综合方案第 4 章](../technical-selection.md#4-better-auth-认证与业务权限) | 确认业务登录规则并通过认证与数据库兼容性验证 |
| 异步任务 | 独立 worker，队列与 API 共享任务契约 | 出现耗时、重试或定时执行需求 |
| Redis | 缓存或任务队列存储 | 确定失效策略、持久化和故障恢复要求 |
| 文件存储 | S3 兼容对象存储 | 出现附件、制品或日志归档 |
| 浏览器实时更新 | 先评估 SSE | 明确进度或日志订阅需求 |

这些能力均未安装或实现。若平台以后执行用户代码或构建命令，应使用独立、受限的执行环境，API 只负责调度和权限检查。

### 4.1 代码平台 API 接入

> **Why & What - GitHub 与 Gitea API**
>
> **选择：** 后端通过 API 接入 GitHub 与 Gitea，按项目需求支持已授权的公有和私有仓库。平台不内置 Git 托管引擎。
>
> **理由：** 复用来源平台的仓库、PR 和 Issue 能力，将开发范围集中在项目业务、代码关联与交付展示。仓库的原生信息继续以来源平台为准。
>
> **备选：** 内置 Git 引擎可以自行控制存储及协议行为，但仍需建设代码评审、仓库运维和 CI/CD 集成，不符合当前已有仓库接入范围。
>
> **代价与退路：** 团队需要维护两套 API 适配，并处理授权、限流、网络故障与实例版本差异。能力缺失时显示原因并提供原平台入口，不伪造成功，也不自动切换为自建 Git 托管。

后端提供范围明确的代码平台接口，分别实现 GitHub 与 Gitea 适配器。业务服务负责平台身份校验、角色、项目与仓库关联及缓存访问；适配器处理来源认证、请求地址、分页、返回值转换和平台错误。原始平台状态与统一展示状态保留明确映射，避免把不同含义的状态合并。前端、CLI 与 Bot 共用后端业务接口，凭据不下发给浏览器，不预建通用插件系统。

认证与客户端采用以下实现方向。GitHub App 与客户端库属于技术建议，具体配置由研发在接入前核定；已确定的 API 接入及私有仓库支持不以这些细节待定为由缩减。

| 平台 | 认证与调用方向 | 接入时需明确的事项 |
| --- | --- | --- |
| GitHub | 推荐 GitHub App，安装到目标个人账号或组织并选择授权仓库；后端通过 Octokit 使用 installation token | 按读取及需求第 10.7 节中的写能力授予权限；维护安装与仓库授权范围，处理令牌续期、安装暂停及卸载 |
| Gitea | 按实例地址接入 REST API，优先评估限定权限的访问令牌，需要用户授权流程时评估 OAuth2；客户端按实例 OpenAPI 及实际接口实现 | 确认支持版本、账号和令牌权限、到实例的网络连通性及凭据撤销方式；不假定兼容 GitHub App 或全部 GitHub API |

私有仓库访问必须同时通过平台权限、项目仓库关联和来源连接授权检查，读取缓存同样受这些检查约束。平台角色沿用[需求第 2 章](../prd/mvp.md)，不新增按项目的权限角色矩阵。共享连接下私有内容的具体可见范围仍需确认；在规则确定前不能仅凭连接持有有效令牌，就向任意登录用户返回内容。后端保存凭据时须采取受控存储措施，日志不记录令牌、私钥或完整敏感响应。

连接记录区分平台类型、实例地址及授权身份。仓库和 Issue／PR 的引用包含连接标识及远端标识，避免不同 Gitea 实例的外部 ID 冲突。缓存按连接、仓库和版本区分；收到撤权事件或确认权限失效后，停止返回该授权范围内的缓存内容。未检测到的撤权通过定期核对收敛，检测时限由项目维护者与研发在接入前确定。

同步采用首次拉取、按需读取与 Webhook 更新相结合的方向，定期核对用于补偿漏事件，并提供手动重试入口。Webhook 按来源校验签名，按连接与事件标识去重。外部请求设置超时和并发上限，区分不支持、授权失败、限流与网络错误；只对确认幂等的操作进行有上限的重试。实现远端写操作前，另行明确冲突、重复提交与结果核对策略。

GitHub Actions 与 Gitea Actions 的工作流文件格式作为平台内置流水线定义的参考，但平台不调用两边的流水线 API，也不承诺配置完全互换。[需求第 6 章](../prd/mvp.md#6-流水线执行节点与提测的独立边界)确定内置流水线的产品边界：控制面负责定义解析、调度、状态、日志与产物，执行面由注册到平台的自托管执行节点使用隔离容器运行。执行节点、队列、日志与产物存储的技术选型在对应规格中确定，整体方案见[流水线功能规划草案](../prd/pipeline-plan.md)。后续若确认 Pi 自动开发需求，才评估独立工作目录中的本地 Git 与执行环境；阅读仓库不依赖全仓克隆。

以下官方能力于 2026-11-07 按文档核对，属于方案依据，尚未使用真实私有仓库或指定 Gitea 实例验证：

- [GitHub App 安装身份认证](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-as-a-github-app-installation)说明仓库授权、installation token 及 HTTP Git 访问；[Octokit](https://github.com/octokit/octokit.js)提供 API、App 和 Webhook 客户端能力。
- [Gitea API 使用说明](https://docs.gitea.com/development/api-usage/)提供认证、分页及实例 OpenAPI 入口；[Actions 差异说明](https://docs.gitea.com/usage/actions/comparison/)列出与 GitHub Actions 的兼容性边界。

## 5. 验收与待定事项

基础工程的验收条件是：`check` 和 `build` 成功，编译后的服务能响应健康检查，开发文档能展示该接口，前端开发代理能转发请求，SIGTERM 能正常退出。运行命令和接口地址统一维护在[后端说明](../../apps/server/README.md)。

研发优先的版本范围、邮箱邀请开通与邮箱密码登录已由产品需求确定。账号恢复、团队归属、项目可见范围等细则继续按 [V0.1 待确认问题](../prd/v0.1.md#7-需要项目维护者确认的问题)讨论；Worker 随实际后台作业需求加入。

代码平台接入的待定细节和产品验收统一见[需求第 12、13 章](../prd/mvp.md)。研发实现时应补充两套适配器的行为测试，覆盖私有仓库读取、超出授权范围、撤权后缓存访问、实例隔离、分页及限流超时；同步测试覆盖 Webhook 验签、重复投递与漏事件核对。上线前使用授权测试仓库验证两边真实接口，不能以模拟数据或单个平台测试代替双平台接入验收。

当前应用共用根级 pnpm workspace 和锁文件，通过 api-client 共享契约。工具链升级需要一起检查应用，模块依赖由工程检查约束；构建顺序由根脚本维护。完整目标结构见[架构方案](system-design.md)。
