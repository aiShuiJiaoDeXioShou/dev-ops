# 设计规范索引

- [设计总规范](DESIGN.md)：优先级、分层、强制规则、AI 工作协议、DoD
- [设计 Token](tokens.md)：颜色、字体、间距、圆角、动效
- [组件选择](components.md)：base 类与 shared UI 的职责划分
- [页面模式](patterns.md)：列表/详情/表单/认证/设置
- [交互规范](interactions.md)：状态、键盘、焦点、权限、反馈
- [UI 债务 baseline](baseline.md)：允许的存量与退出标准

相关来源：

- `design/tokens.json`：机器可读 token
- `apps/web/src/shared/styles/index.css`：token 运行时映射
- `apps/web/src/prototype/styles/`：基础视觉层
- `apps/web/src/shared/ui/`：可访问控件
- `docs/desgin/interactive-prototype-v1/`：原始 HTML 原型与视觉参考
- `tooling/design/ui-baseline.json`：存量违规

检查命令：

```bash
pnpm ui:check
```
