# React 交互原型

V0.1 业务实现前的高保真交互原型，使用与正式 Web 相同的 React、TypeScript、Vite、Tailwind 与 shadcn/ui 组件体系。原型仅在开发环境通过 `/prototype` 路由启用，不进入生产构建；页面、组件与数据层按后续可直接提升为正式页面组织。

## 运行与入口

```bash
pnpm dev:web
# 访问 http://localhost:5173/prototype
```

现有工作台在开发环境也提供「交互原型」导航入口。原型数据保存在浏览器 `localStorage`（`dev-ops-prototype:v1`），可在右侧底部「设置」中切换演示角色或重置数据。

## 目录与职责

```text
apps/web/src/prototype/
├── prototype-app.tsx        # /prototype 路由树
├── layout/                  # 原型应用外壳：侧栏、团队切换、设置、移动抽屉
├── data/                    # 演示类型、初始数据与本地状态（可替换为 TanStack Query + API）
├── components/              # 可复用的展示组件：状态、头像、详情面板、新建表单、占位页
└── pages/                   # 页面：项目列表、项目工作区、需求/Bug、能力、协作等
```

复用规则：

- 展示组件只接收 props 与明确的回调，不直接读取 mock 数据；页面通过 `usePrototype()` 取数。
- 与后端交互的最终形态使用 TanStack Query 查询/变更替换 mock 数据层，组件与布局不变。
- 共享视觉 token 已对齐 MVP：主色 `#4176E6`、侧栏 `#F9FAFB`、主内容 `#FFFFFF`、选中底 `#EBEEF2`。
- 图标、品牌标记与 Bot 头像直接取自 HTML 原型：`icons/icon-paths.ts` 内联本地 Octicons，`public/prototype/brand.svg`、`public/prototype/bots/*.svg` 保存品牌与 Bot 资源；Octicons 许可见 `public/prototype/OCTICONS-LICENSE.txt`。
- 应用 favicon 已替换为原型品牌标记；原型布局字号、表格密度、按钮尺寸和页面间距按 `styles.css` 数值对齐。
- 旧 HTML 原型保留在 `docs/desgin/interactive-prototype-v1/`，作为交互与视觉对照；本目录不修改该原型。

## V0.1 原型（研发流程试用版）

- 入口：`/prototype/v01`，集中链接认证、团队、项目、需求/Bug、代码页签，并说明 V0.1 演示边界。
- 认证：`/prototype/auth/login`、`accept-invitation`、`forgot-password`、`reset-password`，使用原型品牌、tokens 与系统字体；登录页采用左侧 Bot 项目协作现场 + 右侧邮箱登录的分栏布局，表单只做本地校验，不发送真实邮件或请求。
- 事项流程：需求详情按 V0.1 状态机提供动作按钮——开始开发、提交测试（测试负责人/验收标准/测试范围/自测结论）、开始测试、退回开发、测试通过（关联 Bug 阻碍校验）、重新开发、取消/恢复；Bug 提供开始修复、提交回归、回归通过/失败、撤回回归、关闭、重开。每次动作追加本地活动记录，不触发构建、部署、流水线或外部消息。
- V0.1 字段：创建事项支持内置正文或外部文档链接二选一；Bug 可关联同项目需求；项目创建不要求仓库路径，项目设置可模拟关联/取消关联仓库，代码页在未关联仓库时显示空状态。
- 数据：仍在浏览器本地，刷新后部分临时状态回到种子数据；真实认证、数据库、权限、Git 读取以 `specs/001-v01-rd-workflow/` 与 `tasks.md` 为准，本原型只用于视觉与交互预演。

### 登录页视觉规范（参考 OpenBot 官网）

- 画布：`#f4f6f9` 浅灰蓝；内容表面：`#ffffff`；分割线：`#e7eaf0`。
- 字体：Inter / 系统无衬线；品牌标题约 68px、字重 600、字距 -0.055em；正文 15px、行高 1.7。
- 圆角：大卡片 28px、内嵌任务条 12px、按钮与标签 999px。
- 色彩：主文字 `#111318`、次级文字 `#5f6875`；产品蓝 `#4176e6` 用于主操作和 Bot 胶囊，状态保留绿 / 蓝 / 琥珀。
- 控件：浅色画布上的白色协作卡、胶囊主按钮、发丝线分隔；登录区保持白色，不使用深色大面积反差。
- 视觉验证：桌面 1440×1000 与移动端 390×844 用 Playwright 截图检查；登录页文件通过 oxlint、Prettier、`apps/web check` 与 build。

## 视觉实现（与 HTML 原型对齐）

- 原型 CSS 已直接复制到 `apps/web/src/prototype/styles/`（`styles.css`、`workspace.css`、`product.css`、`markdown.css`、`ai-chat.css`、`annotation.css`），只在 `/prototype` 懒加载 chunk 中导入。
- 页面结构、类名、字号、间距、表格密度、状态点、按钮与空状态直接使用原型类名（如 `.page-head`、`.project-header`、`.content`、`.catalog`、`.table-wrap/.table`、`.details`、`.dsh-*`、`.conversation-list`、`.keychain-*`、`.work-page-head` 等），不再用 Tailwind 近似布局。
- 可复用封装位于 `components/proto-controls.tsx`、`proto.tsx`、`prototype-dialog.tsx`：`ProtoButton`、`ProtoIconButton`、`ProtoPageHead`、`ProtoWorkPageHead`、`ProtoSearch`、`ProtoField`、`ProtoEmpty`、`ProtoSectionHeading`、`PrototypeDialog`、`ProtoStatus`、`ProtoAvatar`、`ProtoChip`。
- 图标来自原型 `icons.js` 的本地 Octicons 路径（`icons/icon-paths.ts`），品牌与 Bot 头像来自 `public/prototype/`；应用 favicon 使用原型品牌标记。
- 原生 dialog 使用 `PrototypeDialog`，并以 `inset: 0; margin: auto` 抵消 Tailwind preflight 对居中 margin 的重置。

## 迁移进度

| 原型页面                                          | React 状态                                   |
| ------------------------------------------------- | -------------------------------------------- |
| 应用外壳、侧栏、团队切换、设置、通知中心          | 已完成                                       |
| 项目列表（筛选、统计卡片、项目入口）              | 已完成                                       |
| 项目工作区外壳、页签、项目切换、项目设置          | 已完成                                       |
| 项目需求/Bug 列表、筛选、详情、评论、活动、新建   | 已完成                                       |
| 项目代码（分支/文件/复制/下载）                   | 已完成（示例数据）                           |
| 项目协作（按标签归集的只读会话与任务）            | 已完成（原型 .collab-layout/.dsh-chat 结构） |
| 项目 PR、流水线、产物与版本、环境变量             | 已完成（示例数据与本地交互）                 |
| 全局协作（会话、聊天、任务、@ 引用、群组设置）    | 已完成（原型 CSS/类名与交互）                |
| 运维（服务、事件、值守规则、变更记录）            | 已完成（原型 CSS/类名与交互）                |
| 能力：智能体、Skills、AGENTS.md、记忆、连接与节点 | 已完成（原型 CSS/类名与交互）                |
| 团队凭据库                                        | 已完成（原型 CSS/类名，密钥不回显）          |
| 团队管理（成员、邀请、角色、最后管理员）          | 已完成（原型 CSS/类名）                      |

### 已知限制

- 协作、运维、凭据库、团队管理使用页面内 state；刷新后回到种子数据，不写入全局 store。能力中心数据单独保存在 `dev-ops-prototype:capabilities:v1`。智能体详情已使用原型右侧 `.details.agent-details` 侧栏。
- 「重置演示数据」只重置全局 store 中的团队/项目/事项；其他模块的本地状态与能力数据需在后续统一。
- 项目代码、PR、流水线、产物、环境变量使用示例数据，未连接 Git 平台、CI 或执行系统。
- 登录、接受邀请、密码找回未在原型内实现；原型通过演示角色模拟权限。
- 尚未做 1440px 与 390px 的真实浏览器截图核对，后续验收时补充。

## 开发约定

- 新增页面优先复用 `prototype/components` 下的展示组件和 `shared/ui/controls`，不复制另一套状态徽标、表格与表单样式。
- 页面内交互写入 `data/store.tsx` 的本地数据，刷新后应可恢复；不接后端、Git 平台或执行系统。
- 与 `AGENTS.md` 的业务规则、权限和状态冲突时，以 PRD 与正式规格为准；原型中的演示数据不能作为验收证据。
- 完成一个页面后同步更新本文件的迁移进度，并运行 `pnpm --dir apps/web check` 与 `pnpm --dir apps/web build`。
