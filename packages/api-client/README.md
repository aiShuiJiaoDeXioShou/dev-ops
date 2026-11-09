# API 客户端

Web 和 CLI 通过本包调用现有健康与就绪接口，共用地址处理、超时、取消、错误分类和响应校验。当前不包含认证或业务接口。

接口来源是 Server 注册的 TypeBox schema。根目录 `pnpm api:generate` 将 OpenAPI 导出到 `.artifacts/openapi.json`，再生成本包 `src/generated/` 中的类型和独立校验器。生成内容不提交，也不手工修改。

```bash
pnpm prepare:clients
pnpm --dir packages/api-client check
```

`createApiClient` 接收服务基础地址、超时和可替换的 fetch；基础地址支持反向代理路径前缀。浏览器会话策略由 Web 初始化代码传入，CLI 输出格式与退出码由 CLI 处理。请求失败使用 `RequestError`，主动取消保留取消错误。

成功响应经过契约校验，再筛选公开字段。错误响应也执行契约校验，保留 HTTP 状态、请求标识、校验结果及合法的来源错误码；服务端原始消息不会直接作为用户提示。

生成器使用 openapi-typescript 与 Ajv，Ajv 只在工程工具中运行。客户端使用预编译的 ESM 校验器，不依赖 Server、数据库或运行时校验编译器。新增需要辅助运行库的 schema 时，生成器会明确报错，需先完善生成配置和浏览器兼容验证。

新增接口时先修改后端 schema，再扩展[生成入口](../../tooling/scripts/generate-api-client.mjs)和本包公开方法。运行根目录 `pnpm check` 验证契约生成、调用方类型及错误行为。
