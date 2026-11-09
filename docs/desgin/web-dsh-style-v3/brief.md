# DSH 风格探索稿 v3

## 用户要求
参考用户提供的 DeepSeek Harness 截图，再生成一版 Web 项目管理平台设计。沿用前轮偏好：中性背景，蓝色主要用于按钮及 active 状态；只输出一张图。

## 参考与核验
- 用户截图作为视觉依据：浅灰侧栏、白色内容区、轻分隔线、圆角输入区、蓝色活动页签。
- 官方仓库公开 UI 源码、主题变量和样式规范：
  - https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/web-styling.md
  - https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/ui-theme/README.md
  - https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/ui-theme/src/styles/design-platform.css
  - https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/ui-theme/src/styles/base.css
- 本轮检索未找到可确认的官方公开 Figma 原稿链接；不将开源 UI 实现描述为已获取可编辑设计稿。
- 官方样式中 deepseek-500 为 rgb(65,118,230)，即 #4176E6；圆角等级包含 8/12/16/20px；中性分隔线规范为 0.5px。
- 截图中的桌面侧栏与浏览器默认主题可能不同，本轮按截图视觉适配，并非逐像素复刻所有官方变量。

## 设计结果
dsh-project-workspace.png 为内置 imagegen 生成的单张静态概念图，原有项目任务页面作为业务内容参考。完整提示词见 prompt.md。
- 侧栏采用柔和浅灰，选中底保持灰色，文字及图标使用蓝色。
- 主区白底连续布局，通过细线分栏，减少浮动卡片结构。
- 紧凑顶部标题与任务页签；中间按状态分组列出七个示例任务。
- 右侧展示任务属性、讨论、执行进度和圆角输入框。
- 已目视检查完整图片：三栏结构、任务内容、主按钮及输入框完整可见。
- 所有任务、时间和执行结果均为示例。图像未逐像素测量配色与边框，也未验证响应式和交互；不是 Figma 可编辑稿或前端实现。
- 用户尚未选择此方向作为最终规范。

