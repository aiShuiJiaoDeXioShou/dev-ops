# Dev Ops CLI（devops）

`devops` 是平台面向命令行、脚本与 AI/自动化工具的业务入口。它不实现登录/退出或设备授权；API Token 在 Web 个人页面创建，CLI 通过本地配置、环境变量或标准输入读取。

## 安装与运行

在仓库根目录执行：

```bash
nvm use
pnpm install --frozen-lockfile
pnpm prepare:clients
pnpm --dir apps/cli build
node apps/cli/dist/index.js --help
```

构建后可通过 `node apps/cli/dist/index.js` 运行；声明了 `devops` bin 的包在安装到 PATH 后也可直接执行 `devops`。

## 创建并配置 API Token

1. 登录 Web，点击首页头像进入 `/settings/profile`。
2. 在“API Token”区域新建 Token（名称必填、有效期默认 90 天）。
3. 完整 Token 只显示一次，请复制保存。
4. 在终端配置：

```bash
devops config set server https://devops.example.com
devops config set token          # 隐藏输入
# 或
printf '%s' 'devops_pat_...' | devops config set token

devops config get                 # Token 掩码
devops whoami
```

本地配置保存在 `$XDG_CONFIG_HOME/devops/config.json`（未设置时为平台配置目录），目录 0700、文件 0600、原子写。Token 与 server origin 绑定；修改 server 会清空旧 Token，需要重新设置。`config set token` 只保存已有 Token，不创建 Token。

环境变量/标准输入可用于 CI，优先级高于本地配置：

```bash
export DEV_OPS_SERVER=https://devops.example.com
export DEV_OPS_TOKEN=devops_pat_...
devops whoami --json

printf '%s' "$DEV_OPS_TOKEN" | devops whoami --token-stdin --json
```

Token 不允许通过命令行参数传入；CLI 不刷新/撤销 Token，过期后在个人页面重新创建。

## 常用命令

```bash
devops health
devops ready
devops whoami --json

devops team list
devops project list --search 平台 --status active
devops project repository branches <projectId> --repository <repositoryId>

devops requirement list --project <projectId>
devops requirement get <requirementId> --json
devops requirement submit-test <requirementId> --test-owner <userId> --scope-note "登录页" --self-test-result passed

devops bug list --project <projectId>
devops bug create --project <projectId> --title "登录失败" --phenomenon "..." --expected "..." --reproduction "..."

devops git provider list
devops git connection list
devops project code-reference add <projectId> --repository <repositoryId> --target-type requirement --target-id <requirementId> --object-type commit --remote-id <sha>
```

### 交付上报（V0.2）

```bash
devops delivery report --project <projectId> --file ./build.json --json
cat build.json | devops delivery report --project <projectId> --file -
devops delivery list --project <projectId> --result-status failed --json
devops delivery get <buildId> --json
```

`--file` 读取构建上报 JSON（项目、服务/环境可选、构建标识、版本、来源、采集时间、结果、说明、产物引用与事项关联）；重复上报按「项目＋来源＋构建标识」幂等；失败信息只写入 stderr，退出码 0/1/2。

完整命令面与参数见 [CLI 契约](../../specs/002-cli-business-commands/contracts/cli-commands.md)。

## 输出与退出码

- 默认输出人类可读文本；`--json` 时 stdout 只包含平台成功信封。
- 列表统一为 `{ items, page, pageSize, total }`，裸数组在 CLI 边界归一化。
- 失败时 stdout 为空，错误写 stderr；`--json` 模式 stderr 为错误 JSON。
- 退出码：`0` 成功，`1` 请求/业务/网络/认证/运行失败，`2` 参数/本地配置错误。
- 危险操作非交互环境需显式 `--yes`；长文本可用 `--content-file -` 从 stdin 读取。
- CLI 不缓存业务数据，按服务端实时权限校验。

## 第三方库

CLI 使用 `commander`（命令解析/帮助）、`zod`（配置与输入校验）、`@inquirer/prompts`（隐藏 Token 输入/交互确认）、`env-paths`（配置目录）、`write-file-atomic`（原子写）；HTTP 使用 Node 内置 `fetch`，测试使用 `node:test`。

## 构建与验证

```bash
pnpm --dir apps/cli check
pnpm --dir apps/cli build
```

测试使用本地 HTTP 桩，不依赖公网或生产服务。真实 Gitea/GitHub App/邮件资源未提供时，相关端到端项标记为未验证。
