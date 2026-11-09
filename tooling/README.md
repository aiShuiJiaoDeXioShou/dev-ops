# 工程工具

根目录统一运行契约生成、构建和依赖检查。应用及 API 客户端使用各自声明的 TypeScript 7；openapi-typescript 和 dependency-cruiser 使用根工程的 TypeScript 5.9 编译器 API，两个版本按工作区依赖隔离。

| 位置                                        | 职责                                                   | 验证入口                  |
| ------------------------------------------- | ------------------------------------------------------ | ------------------------- |
| [typescript](typescript)                    | 应用共享的严格类型配置                                 | 各应用 typecheck 和 build |
| [生成脚本](scripts/generate-api-client.mjs) | 从导出的 OpenAPI 生成类型和响应校验器                  | `pnpm api:generate`       |
| [依赖规则](dependency-rules.mjs)            | Web 分层、业务模块公开接口、应用与共享包边界、循环依赖 | `pnpm check:boundaries`   |
| [规则测试](test/dependency-rules.test.mjs)  | 用临时 TypeScript 工程实际验证允许和禁止的导入         | `pnpm test:tooling`       |

`pnpm check` 先构建客户端，再检查依赖，保证生成模块和工作区包能够正确解析。依赖扫描包含类型引用和字面量动态导入，使用 TypeScript 路径别名及 package.json exports。新增跨模块能力通过 public.ts 导出，保持有向无环的依赖关系。

生成器不连接数据库、不监听网络、不读取本地凭据。`.artifacts/`、`src/generated/` 和 `dist/` 均为可重建产物；从干净检出执行 `pnpm install --frozen-lockfile` 和 `pnpm check` 可重新生成。

跨应用联通检查位于 [tests/e2e](../tests/e2e/README.md)。真实 PostgreSQL 验证单独运行 `pnpm test:db`，所需环境见[数据库说明](../docs/architecture/database.md)。
