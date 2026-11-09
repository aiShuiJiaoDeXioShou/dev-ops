# Dev Ops CLI

命令行工具使用 Node.js 和 TypeScript，提供帮助、版本和后端进程健康检查。入口是 [src/index.ts](src/index.ts)，参数解析与退出码处理位于 [src/cli.ts](src/cli.ts)，网络命令位于 [src/commands/health.ts](src/commands/health.ts)。

CLI 通过共享 `@dev-ops/api-client` 调用后端，不直连 PostgreSQL。项目、PR、issue 和 bot 管理命令尚未实现。

## 安装与运行

以下命令在项目根目录执行，Node.js 版本使用根目录 `.nvmrc`，pnpm 版本由本目录 [package.json](package.json) 固定。

```bash
nvm use
pnpm install --frozen-lockfile
pnpm prepare:clients
pnpm --dir apps/cli dev --help
pnpm --dir apps/cli dev --version
```

后端按[后端说明](../server/README.md)启动后，可以执行：

```bash
pnpm --dir apps/cli dev health
pnpm --dir apps/cli dev health --server http://127.0.0.1:3001 --timeout 5000 --json
```

`health` 请求服务基础地址下的 `api/v1/health`，仅检查后端进程存活，不检查数据库或其他依赖。基础地址支持反向代理前缀，例如 `https://example.com/platform` 对应 `/platform/api/v1/health`；不要将 `/api/v1` 重复写入基础地址。

## 参数与输出

| 参数 | 默认值 | 用途 |
| --- | --- | --- |
| `-h` / `--help` | 无参数时显示帮助 | 无需服务在线 |
| `-v` / `--version` | 来自包版本 | 无需服务在线 |
| `--server <地址>` | `DEV_OPS_SERVER`，未设置时为 `http://127.0.0.1:3001` | 仅允许 HTTP/HTTPS，不允许 URL 凭据、查询参数和片段 |
| `--timeout <毫秒>` | `5000` | 整数范围为 `1-300000`，覆盖连接和读取响应体 |
| `--json` | 关闭 | 成功时输出 `{"status":"ok"}` |

配置优先级为命令参数、环境变量、默认值。CLI 读取当前进程的 `DEV_OPS_SERVER`，不会自动加载 `.env`，也不会自动重试或跟随 HTTP 重定向。

结果写入 stdout，错误写入 stderr。退出码为 `0`（成功）、`1`（请求或运行失败）或 `2`（参数错误）。`--json` 仅控制成功结果，失败时 stdout 为空，错误仍是中文文本。

## 构建与验证

```bash
pnpm --dir apps/cli check
pnpm --dir apps/cli build
pnpm --dir apps/cli start --help
node apps/cli/dist/index.js --version
```

`check` 执行类型检查、Oxlint 和 Node 测试，测试使用临时本地 HTTP 服务，无需预先启动后端。`build` 将源码编译到 `dist/`。编译后从任意目录使用入口文件的完整路径运行即可。

脚本需要读取纯 JSON 时，直接运行 `node apps/cli/dist/index.js health --json`，避免包管理器的脚本提示影响输出。包内已声明 `dev-ops` 可执行入口，但初始化不会进行全局安装或发布。

新增命令时，在 `src/commands/` 实现命令，在 `src/cli.ts` 注册参数和分派逻辑，并同步更新帮助、本文档和 `test/` 中的行为测试。应用依赖在本目录声明，锁文件由根工作区统一维护。
