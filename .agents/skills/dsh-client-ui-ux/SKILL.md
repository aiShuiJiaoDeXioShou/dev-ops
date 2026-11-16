---
name: dsh-client-ui-ux
description: DevOps 工作区 Web UI 的设计、实现和评审入口。新增或修改 apps/web 的页面、组件、样式、主题或交互前使用，覆盖布局、对齐、间距、图标、数据状态和浏览器验收。
---

# DevOps Web UI 设计与实现

开始前读项目设计总规范、Token、组件选择、对应页面模式和交互规范。打开目标路由，查找同类页面与共享控件。用 DSH 视觉基准中的对应实图和源码核对布局、密度、排版、控件及明暗主题。本仓库规范决定具体取值、组件和业务行为。[设计总规范](../../../docs/design/DESIGN.md) · [Token](../../../docs/design/tokens.md) · [组件选择](../../../docs/design/components.md) · [页面模式](../../../docs/design/patterns.md) · [交互规范](../../../docs/design/interactions.md) · [DSH 视觉基准](../../../docs/ui-guidelines.md#dsh-reference)

| 改动                                     | 选读                                                                                                                        |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| 页面布局、信息层级、分栏或间距           | [页面布局与响应式](../../../docs/ui-guidelines.md#layout) · [对齐](references/alignment.md) · [间距](references/spacing.md) |
| 窄屏、触控、截断、工具提示或断点下的焦点 | [响应式技能](../dsh-responsive-ui/SKILL.md)                                                                                 |
| 样式、主题或组件                         | [主题与组件](../../../docs/ui-guidelines.md#components)                                                                     |
| 操作图标、图标按钮或信息图标             | [图标](references/icons.md)                                                                                                 |
| 项目品牌、Bot 头像或目录素材             | [素材技能](../dsh-official-plugin-artwork/SKILL.md)                                                                         |
| 控件行为、键盘、菜单或弹窗               | [控件、键盘与浮层](../../../docs/ui-guidelines.md#controls)                                                                 |
| 请求、表单或操作状态                     | [加载、空内容与操作反馈](../../../docs/ui-guidelines.md#feedback)                                                           |
| 会话、输入区或流式输出                   | [对话与流式输出](../../../docs/ui-guidelines.md#conversation)                                                               |

## 页面结构与视觉

- 先确定页面模式、内容层级和适用状态。布局使用 `.page-head`、`.catalog`、`.filters`、`.table-wrap`、`.details` 等 `prototype` 层基础类，可交互控件优先复用 `apps/web/src/shared/ui/controls/`。缺少合适控件时按组件规范补共享实现、示例与状态测试。页面和 feature 禁止新增裸 `<button>`、`<input>`、`<select>`、`<textarea>`、`<table>` 及 `@/prototype/*` 依赖。
- `design/tokens.json` 定义 Token，`apps/web/src/shared/styles/index.css` 提供运行时映射。颜色、圆角、状态色用项目 Token。禁止裸色值和任意 Tailwind 值。沿用本项目的字号、行高和间距，优先用位置、字号和文字色表达层级。浅色工作区采用浅灰侧栏、连续白色主区与细分隔线，蓝色用于主操作、链接和活动态。
- 样式层顺序固定为 `theme, base, prototype, components, utilities`。`apps/web/src/main.tsx` 先导入 `@/prototype/styles/layered.css`，再导入 `./shared/styles/index.css`。
- 从既有控件的角色和尺寸变体选圆角、内距与高度。并排控件以同类元素对齐，嵌套容器检查内外留白，相接表面由外层保持轮廓。检查 hover、选中、加载、禁用与焦点态，保持控件尺寸、可读性和焦点环。

## 控件与状态

- 用共享控件处理 Tab、Enter/Space、方向键及 Esc。弹窗设置初始焦点和焦点陷阱，关闭后归还触发入口。菜单和抽屉保持在视口内并避开滚动容器裁切。按业务处理点击外部关闭和草稿确认。危险操作复用 `AlertDialog`，确认文案交代对象与后果，初始焦点放在安全操作上。
- 数据界面覆盖 loading、empty、no-match、error、read-only、提交中及重试。列表加载保持布局，复用 `DelayedLoading` 和页面状态组件。空数据提供下一步，筛选无匹配提供清除条件，加载失败提供重试，已有数据保留。只读操作按权限规则隐藏或禁用，禁用时说明原因。
- 提交期间防止重复操作。失败时保留草稿，字段错误就地显示，敏感字段按对应流程处理。长列表或详情优先局部重试。成功按用例刷新或关闭，再用共享 Toast 给出一次结果反馈。列表筛选、分页和详情恢复遵循页面模式，整行可点击时保留可聚焦标题入口与行内独立操作。

## 会话与流式输出

全局协作默认发消息，创建任务使用显式入口。项目协作沿用只读模式。改输入区时检查中文输入法组字、`@` 候选、发送失败和草稿。流式生成途中保持「停止生成」可达，核对中断后的部分正文、轨迹和用户阅读位置。[对话与流式输出](../../../docs/ui-guidelines.md#conversation)

## 验收

按[仓库 UI 验收规则](../../../AGENTS.md#ui-验收)确定检查范围、截图尺寸和命令。

- 局部文案或间距等展示改动，在受影响的实际页面核对改动和相邻元素。文案变长或空间变窄时检查换行、截断、溢出。按验收需要截图。
- 共享组件、全局样式或核心交互改动，先从相关入口验收，覆盖受影响的页面模式、尺寸和状态。按改动检查键盘、触控、异步反馈与只读状态，颜色或状态色变化时对照明暗主题。入口验证通过后运行 Web 完整回归。
- 测试夹具仅提供实际覆盖范围内的证据。交付时写明检查结果、已有截图路径，以及未核对的视觉和交互项。纯规范文档变更核对内容、相对链接和命令。
