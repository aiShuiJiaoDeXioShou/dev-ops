# 页面设计与交互

Web 页面、组件、样式和交互变更从 [DSH UI 技能](../.agents/skills/dsh-client-ui-ux/SKILL.md)与[设计规范总入口](design/DESIGN.md)开始。按改动选读以下章节。取值、组件选择和交互验收以本仓库 [设计规范](design/README.md)为准。

<a name="dsh-reference"></a>

## DSH 视觉基准

用对应界面的实图和源码核对布局、密度、排版、控件和明暗主题。官方源码链接固定到本仓库[技术选型](technical-selection.md#5-deepseek-harness-的参考边界)采用的提交。官方演示和截图随产品更新，精确取值以本仓库 Token 为准。

- **工作区**核对分栏、阅读边、标题与工具栏密度。[官网工作区演示](https://www.deepseek.com/harness/) · [布局样式源码](https://github.com/deepseek-ai/deepseek-harness/blob/fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159/packages/client/ui-layout/src/client/AppFrame.module.css)
- **控件与主题**用目录实图看控件和排版，用主题源码核对明暗配色与状态。[插件目录截图](https://www.deepseek.com/harness/images/feat-plugins-zh.webp) · [Web 样式规范](https://github.com/deepseek-ai/deepseek-harness/blob/fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159/docs/web-styling.md) · [主题变量](https://github.com/deepseek-ai/deepseek-harness/blob/fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159/packages/client/ui-theme/src/styles/design-platform.css) · [目录组件](https://github.com/deepseek-ai/deepseek-harness/blob/fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159/packages/client/ui-plugin-manager/src/client/PluginManagerPage.tsx)
- **会话与轨迹**核对输入区位置、滚动区、执行记录的密度与层级。[运行轨迹截图](https://www.deepseek.com/harness/images/feat-trace-zh.webp) · [输入区源码](https://github.com/deepseek-ai/deepseek-harness/blob/fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159/packages/client/ui-conversation/src/client/input/editor/ComposerContentEditable.tsx) · [轨迹表格源码](https://github.com/deepseek-ai/deepseek-harness/blob/fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159/packages/client/ui-trajectory/src/client/TrajectoryTable.tsx)

DevOps 验收时优先对照受影响页面的实拍，必要时补看原型与设计稿。浅色工作区采用连续白底、浅灰侧栏与细分隔线，蓝色强调主操作、链接和活动态。用本仓库的语义 Token 检查深色下的相同层级和可读性。[Web 视觉修订截图](design/web-refresh-2026-11/README.md) · [数据展示与抽屉截图](design/ux-fixes-2026-11/README.md) · [交互原型](desgin/interactive-prototype-v1/README.md) · [DSH 风格探索稿](desgin/web-dsh-style-v3/brief.md)

<a name="layout"></a>

## 页面布局与响应式

先确定列表、详情、表单、认证或设置的页面模式，再检查标题、筛选、正文和操作区的阅读边与间距。窄屏优先重排、换行或改用详情覆盖层，保持关键内容和主操作可达。[页面模式](design/patterns.md) · [响应式技能](../.agents/skills/dsh-responsive-ui/SKILL.md)

<a name="components"></a>

## 主题与组件

配色、排版、圆角和状态从项目 Token 与既有控件入手。页面结构沿用 `prototype` 层基础类，交互复用 shared UI。界面图标查看主技能的图标参考，项目品牌、Bot 头像和目录素材使用素材技能。[设计 Token](design/tokens.md) · [组件选择](design/components.md) · [图标参考](../.agents/skills/dsh-client-ui-ux/references/icons.md) · [素材技能](../.agents/skills/dsh-official-plugin-artwork/SKILL.md)

<a name="controls"></a>

## 控件、键盘与浮层

核对键盘操作、焦点可见、Esc 关闭和焦点归还。在移动端检查菜单与抽屉的可视范围、触控目标和软键盘遮挡。破坏性操作按业务规则使用确认框。[交互规范](design/interactions.md) · [组件选择](design/components.md) · [响应式技能](../.agents/skills/dsh-responsive-ui/SKILL.md)

<a name="feedback"></a>

## 加载、空内容与操作反馈

按状态矩阵同时设计加载、空数据、筛选无匹配、失败、只读、提交中与重试。请求失败时保留已加载内容，提交失败时保留草稿并就地提示，敏感字段遵循对应流程。提交成功时按用例关闭或刷新，再给出一条结果反馈。[交互规范](design/interactions.md) · [组件选择](design/components.md)

<a name="conversation"></a>

## 对话与流式输出

协作页默认发送普通消息，通过明确入口创建任务。工作标签用于归类团队内的会话和任务。[MVP 协作需求](prd/mvp.md#101-独立-bots会话与项目入口)

- 协作会话使用「对话 / 轨迹」页签。消息和生成状态留在对话，工具调用和耗时可在轨迹中查看。任务从标题栏打开，输入区加号可新建任务或插入引用。工作标签在会话设置中维护，群组的成员、Leader、职责和指令也在这里配置。浏览者可查看其有权访问的会话和任务。
- Bot 的执行过程统一从会话「轨迹」查看，智能体详情不设置独立「运行记录」页签。后台运行、配置快照和事件数据继续保留。
- 轨迹显示执行中或最近一次运行，可按类型筛选或搜索步骤。时间线按记录时间显示输入与状态、模型输出、工具调用，点击时间条定位步骤。桌面在右侧显示步骤详情，窄屏用抽屉。内容限于已记录的回复文本、状态和脱敏的工具元数据。
- 输入区保留发送按钮。桌面键盘使用 Enter 发送、Shift+Enter 换行，中文输入法组字时保留 Enter 的确认行为。`@` 候选打开时优先处理候选的选择和 Esc 关闭。发送失败保留草稿。
- 技能详情中的「在 Bots 中使用」打开智能体选择器。选中已配置该技能且可用的智能体后，打开私聊并在输入区预填引用。
- 生成时在原发送位置提供「停止生成」。完成、失败和中断分别展示。中断时保留已输出的内容和可用轨迹。仅在用户已靠近消息末尾时随增量内容滚动，查看历史时保持阅读位置。
- Bot 回答不再展示内联「查看轨迹」链接；运行详情从「轨迹」页签进入。输入区省略常驻键盘提示，但保留 Enter / Shift+Enter 行为。Markdown 使用 GFM 表格，宽表格在消息内滚动。
- 已完成回答下方提供复制、赞踩、回答详情、复制链接、真实用量和时间。桌面默认隐藏内容，在操作区域悬停或键盘聚焦时显示；触屏直接显示。评价允许取消或更换，失败显示错误；复制链接定位到当前会话的回复，访问仍受原有成员权限约束。旧消息缺少用量时不补造数据。
- 会话设置侧栏的「工具权限」维护 Bot 的沙盒或完全访问模式，保存中禁止重复操作，失败保留原值并允许重试。
- 会话设置在头像、名称下方展示紧凑工作标签与 Bot 职责介绍，长介绍可展开。在侧栏内直接编辑 Bot 基础配置、模型绑定和长期记忆，沿用能力页的权限与保存规则；关闭含未保存配置或记忆的侧栏前确认。能力页保留独立入口，记忆页通过 URL 的 `botId` 预选智能体，并用于新增记忆的默认归属。
- 工作标签使用 Tag 展示。会话设置中的加号打开新增与选择标签浮层，任务中使用展开的编辑区。输入名称并按 Enter 可新建并关联，也可搜索选择已有标签。标签上的 × 仅取消当前关联，「管理标签」可改名或确认删除团队标签及其全部关联。保存并刷新期间禁止重复操作，失败保留输入并提供就地重试。
- 窄屏将会话列表收进抽屉。验证长消息、代码块和附件列表的局部滚动，保持输入区与停止按钮可达。

原型用本地模拟验证上述交互。实现真实流式路径时，对照 Bots 架构的运行状态、事件与恢复约定。[协作原型说明](desgin/interactive-prototype-v1/README.md#ai-对话状态与上下文) · [流式与轨迹原型源码](desgin/interactive-prototype-v1/modules/ai-chat.js) · [React 协作原型](../apps/web/src/prototype/pages/collaboration-page.tsx) · [Bots 架构](architecture/bots-architecture.md#7-持久调度事件与恢复)
