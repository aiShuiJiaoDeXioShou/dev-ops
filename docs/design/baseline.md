# UI 债务 baseline

## 为什么存在

现有代码已有历史遗留的裸控件、任意 Tailwind 值和 `@/prototype` 依赖。为了先建立门禁而不阻塞业务，`tooling/design/ui-baseline.json` 记录这些存量数量。

`pnpm ui:check` 的规则：

- 当前违规数量 > baseline：失败；
- 出现 baseline 中没有的新文件/新规则：失败；
- 违规数量降低：通过；
- 无理由更新 baseline 来“消掉”新增违规：禁止。

## 规则

| 规则 | 检查内容 |
| --- | --- |
| `raw-control` | 页面/feature 中直接使用 `<button>/<input>/<select>/<textarea>/<table>` |
| `arbitrary-value` | className 中的任意 Tailwind 值（`w-[...]` 等） |
| `hardcoded-color` | TSX 中的 `#hex`、`rgb()`、`rgba()` |
| `prototype-import` | 生产页面/feature 直接 import `@/prototype/*` |
| `inline-style` | 页面/feature 中的内联 `style={{...}}` |

## 维护

禁止直接手改 baseline 数字。需要更新时：

```bash
pnpm ui:baseline
```

更新必须说明原因，且只允许用于“确实无法立即迁移”的特殊场景；正常开发应优先迁移到 shared UI。

## 退出标准

baseline 中每条记录都应按页面逐步归零。新增页面不得把 baseline 当成豁免。
