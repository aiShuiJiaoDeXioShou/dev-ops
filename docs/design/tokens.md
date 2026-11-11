# 设计 Token

## 唯一来源

`design/tokens.json` 是 token 的唯一来源。  
`apps/web/src/shared/styles/index.css` 是它在 Tailwind / CSS 中的运行时映射。

> 2026-11 校准：侧栏 232px、桌面内容区 padding 24px、移动端 16px、页面标题 19px，与截图/页面实测一致；修改布局先改 token 和 CSS，再同步本表。`pnpm ui:check` 会校验两者是否一致，禁止只改一边。

## 颜色（浅色主题）

| Token | 值 | 用途 |
| --- | --- | --- |
| `background` | `#ffffff` | 主内容背景 |
| `foreground` | `#0f1115` | 主文字 |
| `card` | `#ffffff` | 卡片/面板 |
| `primary` | `#4176e6` | 主操作、链接、活动态 |
| `primaryForeground` | `#ffffff` | 主操作文字 |
| `secondary` | `#f9fafb` | 次级表面、侧栏 |
| `muted` | `#f5f6f7` | 模块底、弱背景 |
| `mutedForeground` | `#61666b` | 次级文字 |
| `accent` | `#ebeef2` | 中性选中底 |
| `destructive` | `#ce5252` | 危险操作、错误 |
| `border` | `rgba(15, 17, 21, 0.08)` | 发丝线 |
| `input` | `rgba(15, 17, 21, 0.12)` | 输入边框 |
| `sidebar` | `#f9fafb` | 侧栏 |
| `sidebarForeground` | `#0f1115` | 侧栏文字 |

## 状态色

| Token | 值 | 用途 |
| --- | --- | --- |
| `success` | `#269650` | 成功、正常、已完成 |
| `warning` | `#c98719` | 待处理、暂停、需要注意 |
| `danger` | `#ce5252` | 错误、失败、破坏性 |
| `info` | `#4176e6` | 进行中、信息 |

状态必须同时有文字或图标，不能只靠颜色表达。

## 原型视觉别名

`.shell`、`.login-shell`、`.auth-shell` 内使用原型 CSS 别名：`--blue`、`--blue-soft`、`--side`、`--soft`、`--selected`、`--ink`、`--quiet`、`--line`、`--green`、`--amber`、`--red`。别名值必须与上面的 token 一致。

## 圆角

| Token | 值 | 用途 |
| --- | --- | --- |
| `base` | `0.625rem`（10px） | 基础圆角 |
| `sm` / `md` | 6px / 8px | 小控件 |
| `lg` / `xl` | 10px / 14px | 卡片、面板 |
| `2xl` | 18px | 大面板 |
| `full` | 999px | 药丸按钮、标签 |

## 字体与字号

| 项 | 值 |
| --- | --- |
| 字体 | `'Geist Variable', 'PingFang SC', 'Microsoft YaHei', sans-serif` |
| 正文 | 14px / 1.5 |
| 辅助文字 | 12px |
| 页面标题 | 19px |
| 展示标题 | 25px |

## 间距与布局

| 项 | 值 |
| --- | --- |
| 基础单位 | 4px |
| xs / sm / md / lg / xl / 2xl | 4 / 8 / 12 / 16 / 24 / 32px |
| 侧栏宽度 | 232px |
| 桌面内容区左右 padding | 24px |
| 移动端内容区左右 padding | 16px |

## 动效

| 项 | 值 |
| --- | --- |
| fast | 150ms |
| normal | 200ms |
| slow | 320ms |
| 减少动效 | 必须尊重 `prefers-reduced-motion` |

## 修改流程

1. 先改 `design/tokens.json`。
2. 同步 `apps/web/src/shared/styles/index.css`。
3. 运行 `pnpm ui:check`。
4. 检查受影响的页面截图；token 变更属于设计变更，不能只改 token 不改文档。
