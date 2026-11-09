# collaboration feature

- `api/`：TanStack Query 查询与 mutation；统一使用 `@/shared/api/client` 与业务错误类型。
- `model/`：筛选、表单、状态标签与类型。
- `ui/`：展示与交互组件，不直接拼接请求地址。
- `public.ts`：跨 feature/page 的唯一公开入口。

所有写操作由服务端重新鉴权；只读角色不展示可写按钮，但服务端仍是最终权限来源。
