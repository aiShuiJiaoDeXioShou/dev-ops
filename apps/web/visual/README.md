# Web 视觉与布局回归

Playwright 视觉回归用于阻止“页面能打开但布局/状态不可读”的回归；数据全部来自 `fixtures.ts` 的脱敏 mock，不依赖本机数据库或后端。

## 运行

```bash
pnpm test:visual                 # 比对现有基线
pnpm --dir apps/web test:visual -- --update-snapshots   # 明确改变布局后更新基线
```

首次在新机器运行需要安装浏览器：

```bash
pnpm --dir apps/web exec playwright install chromium
```

## 基线内容

- `__snapshots__/{desktop|mobile}/.../*.json`：页面标题、页签、行数、状态徽标文本、文档横向溢出、可交互控件手型光标、过小点击目标等布局不变量。
- `__snapshots__/{desktop|mobile}/.../*.aria.txt`：主内容区的 ARIA 快照，覆盖结构与可访问名称。
- 失败时 `test-results/` 保存截图、trace 与错误上下文；CI 会作为 artifact 上传。
- 不采用逐像素截图对比：中文字体与操作系统渲染差异会让本地 macOS 与 CI Linux 基线互相误报。像素截图作为人工评审产物，而不是门禁。

## 覆盖范围

- 桌面 1440×1000：项目首页、需求列表/详情、Bug、代码、PR、流水线、产物、环境变量、变更、Skills、模板、凭据、团队、节点、储存桶、个人页、项目设置弹窗、需求创建、变更计划创建。
- 移动 390×844：项目首页、需求列表/整屏详情、团队设置、项目设置弹窗。

## 更新与评审

1. 先确认布局变更是有意的，并在 PR 说明中写清原因。
2. 更新快照后检查 `test-results` 截图。
3. 不要为了通过测试缩小覆盖范围或删除不变量。
