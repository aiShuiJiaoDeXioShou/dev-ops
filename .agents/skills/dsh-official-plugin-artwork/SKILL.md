---
name: dsh-official-plugin-artwork
description: 设计或评审 DevOps 工作区的项目品牌、Bot 头像、能力目录配图和功能预览时使用。工具栏、菜单、按钮等操作图标使用 dsh-client-ui-ux 的图标参考。
---

# DevOps 品牌与能力目录素材

先查已有素材、实际使用的尺寸和同类条目。项目标识使用已选用的折叠 D，Bot 头像沿用现有静态或动态版本。Skills 和 AGENTS.md 模板目录沿用本项目的分类、状态与详情结构。特定条目的独立配图或功能预览随对应需求制作。[项目品牌](../../../apps/web/public/prototype/brand.svg) · [Bot 素材](../../../apps/web/public/prototype/bots/) · [能力页模式](../../../docs/design/patterns.md#能力页skills--agentsmd-模板)

## 设计与落地

- 保留已有标识的辨识特征。新素材先明确对应对象、卡片或头像中的实际尺寸和相邻素材。比较实际尺寸下的轮廓、留白和视觉重量。识别对象的素材可沿用自身配色，卡片背景、边界、标签和状态仍使用项目 Token。[DSH 目录参考](../../../docs/ui-guidelines.md#dsh-reference) · [项目组件规范](../../../docs/design/components.md#图标与品牌)
- 资源就近复用并从项目本地加载。修改矢量标识时保留可编辑的 SVG。内联 SVG 使用遮罩、渐变或裁剪 ID 时，检查同页多个实例的 ID 是否独立。动态头像保持可用的静态表现，并验证 `prefers-reduced-motion`。
- 素材承担信息时提供有意义的替代文本，已有邻近文字完整说明时使用空 `alt`。功能预览以已有界面和真实能力为基础，标签和状态沿用项目词汇。目录或详情的可交互部分复用 shared UI。

## 验收

查看素材在受影响的条目、卡片、列表和详情里的实际大小、裁切、明暗主题与窄屏效果。独立素材交付时附使用尺寸的预览。素材接入 Web 后按主技能完成浏览器截图和工程检查。[DSH UI 技能](../dsh-client-ui-ux/SKILL.md#验收)
