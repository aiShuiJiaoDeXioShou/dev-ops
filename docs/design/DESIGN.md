# DevOps 工作区设计规范

> 状态：v1.0（2026-11-10）  
> 适用范围：`apps/web` 正式页面、`/prototype` 交互原型、认证页、项目工作区与设置页。  
> 本文是 UI 实现的总入口。任何 UI 变更开始前必须先阅读本文，再阅读对应组件、模式和交互文档。

## 1. 设计源与优先级

发生冲突时按以下顺序取权威值：

1. **token**：`design/tokens.json` + `apps/web/src/shared/styles/index.css`
2. **可访问控件**：`apps/web/src/shared/ui/controls/`
3. **基础视觉层**：`apps/web/src/prototype/styles/`（通过 `layered.css` 分层接入）
4. **页面模式**：`docs/design/patterns.md`
5. **交互规范**：`docs/design/interactions.md`
6. **参考原型与设计稿**：`docs/desgin/interactive-prototype-v1/`、`docs/desgin/web-baselines-v1/`

原型截图和旧设计稿只作为视觉参考，**不是绕过 token、控件和交互规范的借口**。  
如果视觉参考和交互规范冲突，以交互规范和 `docs/design/` 为准；如果 token 和页面局部值冲突，以 token 为准。

## 2. 样式分层

`apps/web/src/main.tsx` 必须先导入 `@/prototype/styles/layered.css`，再导入 `./shared/styles/index.css`。  
`layered.css` 固定层顺序：

```css
@layer theme, base, prototype, components, utilities;
```

| 层 | 来源 | 职责 |
| --- | --- | --- |
| `theme` | Tailwind / token 变量 | 颜色、圆角、字体等全局 token |
| `base` | Tailwind preflight | 浏览器基础重置 |
| `prototype` | `apps/web/src/prototype/styles/*.css` | `.page-head`、`.catalog`、`.table`、`.btn`、`.field`、`.details` 等基础视觉与布局 |
| `components` | `shared/ui/controls`、Tailwind 组件 | 可访问控件与组合组件 |
| `utilities` | Tailwind utilities | 仅用于布局微调和 token 无法表达的局部行为 |

**不要新引入样式层，不要用 Tailwind 任意值绕过 `prototype` 层。**

## 3. 强制规则

1. 颜色、圆角、状态色必须来自 token；禁止在页面和 feature 中写裸 `#hex`、`rgb()`、`oklch()`。
2. 禁止任意 Tailwind 值（例如 `w-[373px]`、`text-[13px]`、`bg-[#...]`）；确实需要时先补 token 或基础类。
3. 可访问控件优先使用 `@/shared/ui/controls`：输入、选择、文本域、对话框、确认框、Tabs、表格、下拉菜单、开关。
4. 原生 `<button>`、`<input>`、`<select>`、`<textarea>`、`<table>` 属于历史债务；**新增代码不得再裸写**。已有页面先登记在 `tooling/design/ui-baseline.json`，按页面逐步迁移。
5. 布局结构使用 `prototype` 层的基础类（如 `.page-head`、`.catalog`、`.filters`、`.table-wrap`、`.details`），不要临时自造一套新的页面骨架。
6. 生产页面不要新增 `@/prototype` 依赖；图标、品牌资源等公共内容应逐步迁移到 `shared/`。当前存量在 baseline 中登记。
7. 所有异步界面必须覆盖 loading、empty、error、disabled/read-only、retry 状态；不能只实现成功态。
8. 所有对话框必须处理焦点陷阱、初始焦点、Esc 关闭、关闭后焦点归还；危险操作必须二次确认。
9. 键盘路径必须可用：Tab 顺序合理，Enter/Space 可触发，Esc 可关闭浮层，焦点可见。
10. 任何 UI 改动完成后必须运行 `pnpm ui:check`；不得为了通过检查而无理由扩大 baseline。

## 4. AI 实现协议

任何 AI 或开发者做 UI 任务，按以下顺序执行：

1. 阅读 `docs/design/DESIGN.md`、相关组件文档、对应页面模式。
2. 判断页面类型：列表、详情、表单、认证、设置、空状态。
3. 查找可复用组件；没有合适组件时先补组件和 story/示例，不在页面里硬拼。
4. 先写页面结构和状态，再补样式；禁止先写 Tailwind 再“想办法对齐”。
5. 运行 `pnpm ui:check`，修复新增违规；历史 baseline 只能减少，不能增加。
6. 运行 `pnpm --dir apps/web lint`、`pnpm --dir apps/web typecheck`、相关测试。
7. 在 1440×1000 和 390×844 下截图；对照 `docs/desgin/interactive-prototype-v1/` 或对应设计参考，记录差异。
8. 在提交说明中写明：使用的组件、覆盖的状态、截图路径、未解决差异。

## 5. 完成定义（DoD）

- [ ] 使用 token 和既有基础类，没有新增裸色值/任意 Tailwind 值。
- [ ] 使用 shared UI 控件；未新增 raw control。
- [ ] loading / empty / error / disabled / read-only / 重试 状态已覆盖。
- [ ] 键盘和焦点行为已验证。
- [ ] `pnpm ui:check` 通过，且没有扩大 baseline。
- [ ] `pnpm --dir apps/web check` 通过。
- [ ] 1440×1000 与 390×844 截图已对比参考设计。
- [ ] 变更说明中列出视觉与交互差异。

## 6. 相关文档

- [设计 token](tokens.md)
- [组件选择与使用](components.md)
- [页面模式](patterns.md)
- [交互规范](interactions.md)
- [UI 债务 baseline](baseline.md)
