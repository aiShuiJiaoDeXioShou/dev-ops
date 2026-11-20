# API 客户端

Web 和 CLI 共用本包处理 API 地址、会话、超时、取消、统一响应信封和业务错误。

接口来源是 Server 注册的 TypeBox schema。根目录 `pnpm api:generate` 将 OpenAPI 导出到 `.artifacts/openapi.json`，再生成本包 `src/generated/` 中的接口类型。生成内容不提交，也不手工修改。

```bash
pnpm prepare:clients
pnpm --dir packages/api-client check
```

`createApiClient` 接收服务基础地址、超时和可替换的 fetch；基础地址支持反向代理路径前缀。浏览器会话策略由 Web 初始化代码传入，CLI 输出格式与退出码由 CLI 处理。请求失败使用 `RequestError`，主动取消保留取消错误。

客户端解包统一响应信封，返回按契约声明的业务数据和请求标识。运行时按 HTTP 状态及信封的 `success` 和 `code` 处理失败。

新增接口时先修改后端 schema，再扩展[生成入口](../../tooling/scripts/generate-api-client.mjs)和本包公开方法。运行根目录 `pnpm check` 验证契约生成、调用方类型及错误行为。
