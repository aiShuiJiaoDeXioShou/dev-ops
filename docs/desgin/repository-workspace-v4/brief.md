# 仓库中心工作台 v4

## 本轮要求与范围
用户明确主题色采用 DeepSeek 设计规范，功能以 Git 仓库为核心，项目管理围绕仓库展开；结合 docs/prd/mvp.md 设计一张静态基准图。继续使用 BD Flutter Dev 设计流程与内置 imagegen。
本轮只更新设计产物，未修改 MVP 正文或业务代码。

## 信息架构
- 默认首页保留“我的工作台”：分配给个人的 PRD、Bug 和独立待办。
- 仓库作为主要工作入口：仓库上下文下查看代码、需求、Bug、PR、产物与版本、上下文。
- 项目作为跨仓库、跨服务的产品汇总维度；不规定项目、仓库、服务为一对一。
- 图中概览串联 Git 上下文、业务事项与服务交付，选中事项后右侧展开详情。
- 仓库与事项、服务的映射机制、跨仓库事项的展示去重规则仍需产品细化，不以本图推断数据库约束。

## MVP 对齐
- 第 1、10 章：第一版 Bot 为项目与运维辅助。本图显示汇总 PR 与变更记录，不呈现 Agent 自动开发。
- 第 3 章：个人工作台入口保留；独立待办仍允许不关联项目或仓库。
- 第 4、5 章：人工维护业务进度，Git 分支、提交与 PR 提供代码依据；事项负责人为人类成员。
- 第 6 章：“标记提测”为业务状态动作，不触发、等待或重试流水线。
- 第 7、8 章：服务交付表分别展示最新构建产物、测试运行版本和生产运行版本；查看产物与访问环境是读取入口。
- 第 9 章：不引入平台执行发布、提审或生产部署的按钮。
- 第 11、12 章：不将 PRD 与特定产物的绑定视为已确认需求；下方交付表属于仓库与服务维度。
- MVP 现有“以项目为核心”与用户最新“以 Git 仓库为核心”存在更新，设计采用本轮明确修正。最终对象关系需在后续 PRD 定稿中同步。
- 业务进度标签仅为界面演示，第 12 章待定的状态枚举没有因此定稿。
- 代码页签是仓库代码信息入口的设计候选，不代表内置在线 IDE 或已明确 Git 平台读写范围。

## DeepSeek 主题依据
来源：
https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/ui-theme/src/styles/design-platform.css
https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/ui-theme/src/styles/base.css
https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/web-styling.md

使用官方 deepseek-500（#4176E6）作为用户要求的蓝色强调与主要操作色，对应官方 link 和 button-info-fill。官方默认 button-primary-fill 本身使用近黑色，并非所有官方按钮都是蓝色；本项目将主要操作映射到该官方蓝色色阶。
白色主区、#F9FAFB 侧栏、#F5F6F7 模块底、#EBEEF2 中性选中底，主文字 #0F1115，次文字 #61666B。精确目标记录于 theme.json。
生成图是视觉概念，未以像素取样证明严格命中色值；后续可编辑稿与前端以 theme.json 的确定值为准。

## 交付与检查
- repository-workspace.png：唯一生成图，完整三栏仓库概览。
- prompt.md：完整图像生成提示词。
- theme.json：本轮设计目标值及官方变量映射。
已目视检查生成图：仓库主入口、PRD/Bug 事项、Git 关联、Bot 辅助讨论以及构建产物与环境运行版本的分离均可见。
图中任务、仓库、PR、时间和版本为示例，不代表已接入的真实平台数据。尚未验证交互、响应式布局、无障碍对比度或实现功能。Bug 图标生成偏离常规虫形，正式组件阶段需统一图标语义。
用户尚未确认此图为最终设计基准。

