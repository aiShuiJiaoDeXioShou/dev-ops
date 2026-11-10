# 组件选择与使用

## 选择原则

1. 可交互控件优先使用 `apps/web/src/shared/ui/controls/`。
2. 页面结构使用 `prototype` 层的基础类，不重新发明页面骨架。
3. 没有合适组件时，先补 shared 组件、JSDoc、示例和状态测试，再在页面使用。
4. 现有裸控件是历史债务，登记在 `tooling/design/ui-baseline.json`；修改相关页面时优先顺手迁移。

## 基础类（prototype 层）

这些类来自 `apps/web/src/prototype/styles/`，是 V0.1 工作区的视觉基础：

| 场景 | 类 |
| --- | --- |
| 页面头部 | `.page-head`、`.work-page-head`、`.compact-page-head` |
| 内容容器 | `.catalog`、`.content`、`.work-padding`、`.v01-page` |
| 标题区 | `.section-heading`、`.counter` |
| 筛选与搜索 | `.filters`、`.search`、`.segments`、`.segment`、`.project-filter` |
| 表格 | `.table-wrap`、`.table`、`.vault-table` |
| 详情面板 | `.details`、`.detail-top`、`.detail-scroll`、`.properties` |
| 空状态 | `.empty`、`.empty-state`、`.empty-art` |
| 状态与标签 | `.status`、`.dot`、`.badge`、`.work-chip` |
| 对话/工作区 | `.collab-layout`、`.conversation-list`、`.work-task-panel`、`.dsh-*` |

基础类只负责视觉和布局；交互行为由 React 组件承担。

## shared UI 控件

| 组件 | 路径 | 用途 |
| --- | --- | --- |
| `Button` | `shared/ui/controls/button.tsx` | 主要/次要/幽灵/危险操作，支持 loading/disabled |
| `Input` | `shared/ui/controls/input.tsx` | 单行输入 |
| `Textarea` | `shared/ui/controls/textarea.tsx` | 多行说明、评论 |
| `Select` | `shared/ui/controls/select.tsx` | 原生 select 封装；筛选和表单优先使用 |
| `Checkbox` / `Switch` | `shared/ui/controls/checkbox.tsx` / `switch.tsx` | 布尔选项、启停 |
| `Dialog` | `shared/ui/controls/dialog.tsx` | 表单/详情弹窗，含焦点陷阱 |
| `AlertDialog` | `shared/ui/controls/alert-dialog.tsx` | 破坏性操作二次确认 |
| `DropdownMenu` | `shared/ui/controls/dropdown-menu.tsx` | 行操作菜单 |
| `Sheet` | `shared/ui/controls/sheet.tsx` | 移动端抽屉 |
| `Tabs` | `shared/ui/controls/tabs.tsx` | 页面内分组 |
| `Table` | `shared/ui/controls/table.tsx` | 数据表格容器 |
| `Badge` / `Tag` | `shared/ui/controls/badge.tsx` / `shared/ui/tag.tsx` | 状态、分类标签 |
| `Card` | `shared/ui/controls/card.tsx` | 卡片容器 |
| `Alert` | `shared/ui/controls/alert.tsx` | 错误/提示摘要 |
| `Toast` | `shared/ui/toast.tsx` | 操作结果反馈 |
| `PageLoading` / `PageError` / `EmptyState` | `shared/ui/page-state.tsx` | 页面级状态 |
| `DelayedLoading` | `shared/ui/delayed-loading.tsx` | 延迟渲染加载占位（默认 200ms），避免快速请求导致骨架闪烁 |
| `PageSkeleton` / `Skeleton` | `shared/ui/page-skeleton.tsx` / `skeleton.tsx` | 加载骨架 |

## 页面中不允许的写法

```tsx
// 禁止：裸色值
<div style={{ color: '#4176e6' }} />

// 禁止：任意 Tailwind 值
<div className="w-[373px] text-[13px]" />

// 禁止：新增裸控件而不登记
<button className="...">保存</button>

// 禁止：页面直接使用 radix-ui
import { Dialog } from 'radix-ui'
```

## 推荐写法

```tsx
<Button variant="outline" size="sm" disabled={isPending}>
  {isPending ? '保存中…' : '保存'}
</Button>

<Select aria-label="项目状态" value={status} onChange={...}>
  <option value="">全部状态</option>
</Select>

<Dialog open={open} onOpenChange={setOpen}>
  <DialogContent>...</DialogContent>
</Dialog>
```

## 按钮规则

- 主操作：每一屏最多一个主要按钮。
- 危险操作：使用 `AlertDialog`，不得直接执行。
- 加载中：按钮文字切换为“保存中… / 提交中…”，同时禁用。
- 只读/无权限：隐藏还是禁用由业务决定；禁用时必须说明原因，不能只变灰。
- 图标按钮必须有 `aria-label`，并保持至少 32×32px 触控区域。

## 表单规则

- 标签始终可见，不能用 placeholder 代替 label。
- 校验错误显示在字段附近，用 `role="alert"`；保留用户输入。
- 提交中禁用重复提交。
- 后端业务错误展示可操作说明，不暴露堆栈/SQL。
- 取消/关闭前有未保存修改时提示确认。

## 表格规则

- 列顺序固定：标识/标题 → 负责人 → 状态 → 操作。
- 行可点击打开详情时，标题也应可聚焦打开。
- 加载骨架与最终布局同尺寸，避免跳动。
- 空数据、无匹配、请求失败必须区分。

## 图标与品牌

- 生产页面当前通过 `PrototypeIcon` 使用原型 Octicons；该依赖属于待迁移项。
- 品牌资源使用 `apps/web/public/prototype/` 下的 `brand.svg` 和 Bot 头像；不要从外部 URL 引用。
- 新图标优先使用 `lucide-react` 或 shared 图标封装；不要在页面内粘贴 SVG 路径。
