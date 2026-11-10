# 页面模式

## 1. 列表 + 详情

适用：项目、需求、Bug、代码引用等。

结构：

```
.page-head
  h1 + 统计/说明 + 主操作
.catalog
  .filters
    .segments / select / .search
  .table-wrap > .table 或 .project-grid
  .details（右侧详情，必要时 portal 到详情宿主）
```

要求：

- 筛选条件写入 URL；刷新/返回可恢复。
- 打开详情后筛选条件保持；修改导致不匹配时记录移出但详情保留。
- 关闭详情恢复列表滚动位置。
- 列表状态：loading、error、empty、no-match、read-only。
- 行操作不放在标题里造成意外跳转；行内有明确按钮。

参考实现：

- `apps/web/src/features/projects/ui/project-list.tsx`
- `apps/web/src/features/requirements/ui/requirement-list.tsx`
- `apps/web/src/features/bugs/ui/bug-list.tsx`

## 2. 详情面板

适用：需求、Bug、项目。

结构：

```
.details
  .detail-top：标题 + 编辑/展开/关闭
  .detail-scroll：属性、描述、关联、讨论/活动
  .composer：输入 + 发送
```

要求：

- 默认宽度 375px 左右，小屏改为覆盖式。
- 编辑与关闭按钮必须有 aria-label。
- 未保存修改时关闭要确认。
- 评论/活动分页失败时保留已加载内容并提供重试。

## 3. 表单弹窗

适用：创建项目、邀请成员、需求/Bug 动作。

结构：

```
Dialog
  DialogHeader：标题 + 说明
  form
    字段组
    field-error
    DialogFooter：取消 + 主操作
```

要求：

- 打开时聚焦第一个字段或标题。
- ESC/遮罩关闭遵循业务：有未保存内容时确认。
- 主操作 loading 时禁止重复提交。
- 失败时弹窗不关闭，输入保留。
- 成功后关闭并将焦点归还触发按钮。

## 4. 认证页

适用：登录、接受邀请、找回密码、重置密码。

当前视觉基线：

- 分栏：左侧品牌/特色，右侧认证表单。
- 背景使用 `--background` / 认证页专用类；不新写裸色值。
- 表单控件使用 shared Input/Button；错误提示可见、可读。
- 页面宽度 1440/390 下均不能横向滚动。

要求：

- 登录失败文案不区分“邮箱不存在/密码错误”时，按安全策略统一提示。
- 提交中禁用按钮；支持 Enter 提交。
- 邀请 token 失效/已使用时给出明确恢复入口。
- 不展示不存在的 SSO 入口。

## 5. 设置页

适用：团队、项目设置、仓库连接。

结构：

```
.page-head / .work-page-head
.settings-section
  .section-heading
  .field / .table / .empty
```

要求：

- 仅管理员可见的入口在前端隐藏，服务端仍需鉴权。
- 变更保存后给出 toast；失败保留表单。
- 破坏性操作使用二次确认。
- 空状态提供下一步操作。

## 6. 响应式

| 断点 | 要求 |
| --- | --- |
| ≥ 1280 | 双栏/三栏完整布局 |
| 768–1279 | 侧栏收窄，详情面板可覆盖 |
| < 768 | 单列；表单单列；表格允许横向滚动；触控目标 ≥ 32px |

截图检查尺寸：

- 桌面：1440×1000
- 移动：390×844
