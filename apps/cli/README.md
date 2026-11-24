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
devops requirement pass-test <requirementId> --conclusion "主流程通过"

devops bug list --project <projectId>
devops bug create --project <projectId> --title "登录失败" --phenomenon "..." --expected "..." --reproduction "..."

devops git provider list
devops git connection list
devops project code-reference add <projectId> --repository <repositoryId> --target-type requirement --target-id <requirementId> --object-type commit --remote-id <sha>
```

`requirement pass-test` 直接提交测试结论。未解决的关联 Bug 可继续处理，提醒由 Web 的测试通过弹窗显示。

### 交付上报（V0.2）

```bash
devops delivery report --project <projectId> --file ./build.json --json
cat build.json | devops delivery report --project <projectId> --file -
devops delivery list --project <projectId> --result-status failed --json
devops delivery get <buildId> --json
```

`--file` 读取构建上报 JSON（项目、服务/环境可选、构建标识、版本、来源、采集时间、结果、说明、产物引用与事项关联）；重复上报按「项目＋来源＋构建标识」幂等；失败信息只写入 stderr，退出码 0/1/2。

完整命令面与参数见 [CLI 契约](../../specs/002-cli-business-commands/contracts/cli-commands.md)。

### 代码与 PR 读取（V0.2）

```bash
devops code branches <projectId> --repository <repositoryId>
devops code tree <projectId> --repository <repositoryId> --ref main
devops code file <projectId> --repository <repositoryId> --path src/main.ts

devops project repository commits <projectId> --repository <repositoryId> --ref main
devops project repository commit <projectId> --repository <repositoryId> --ref <sha>
devops project repository pull-requests <projectId> --repository <repositoryId> --state open
devops project repository pull-request <projectId> --repository <repositoryId> --number 12
devops project repository pull-request-diff <projectId> --repository <repositoryId> --number 12
```

代码与 PR 读取全部只读；来源失败按 `EXTERNAL_AUTH_FAILED`／`EXTERNAL_UNAVAILABLE`／`EXTERNAL_UNSUPPORTED` 返回，空列表只表示来源真实为空。交互式确认、`--yes` 与 Token 只从环境变量或标准输入读取等统一规则见上节；流水线运行、审核与发布、晴雨表对应的 CLI 入口见下节。

## V0.8 项目、交付与协作

```bash
devops pipeline workflow list <projectId> --json
devops pipeline run trigger <projectId> --workflow .devops/workflows/ci.yml --ref main
devops pipeline run logs <runId> --step 1 --follow
devops pipeline run wait <runId> --json
devops pipeline artifact download <artifactId> --output ./artifact.tar
devops delivery version list <projectId> <serviceId>

devops attachment upload <projectId> --file ./evidence.txt --content-type text/plain --json
devops requirement update <requirementId> --plan-file ./plan.json --attachment <attachmentId>
devops requirement submit-test <requirementId> --test-owner <userId> --test-owner <secondUserId> --scope-note "登录" --self-test-result passed

devops conversation list --all --json
devops conversation send <conversationId> --file ./message.json
devops conversation events <conversationId> --run <runId> --follow
devops conversation usage <conversationId> --json
devops conversation queued-inputs <conversationId> --json
devops conversation withdraw-input <conversationId> <messageId> --yes --json
devops task list <conversationId> --json
devops task get <taskId> --json # 历史任务仅供只读查询
devops task inbox --json # 等你回复的会话
devops skill export <skillId> --output ./skill.zip
```

附件上传返回 `data.attachment.id`。需求或 Bug 更新时，重复的 `--attachment` 构成完整附件列表。添加新附件时一并传入要保留的附件 ID。`--plan-file` 接受流程节点数组，每个节点包含 `id`、`title`、`startsOn`、`endsOn` 和 `tasks`。日期采用 `YYYY-MM-DD` 或 `null`。

消息请求示例为 `{"text":"检查当前交付","clientRequestId":"<每次发送唯一的 UUID>"}`。长任务直接通过会话消息交给 Bot；`task` 仅保留历史任务查询和等你回复的会话汇总，创建、补充、转交及验收命令已移除。需要验收的工作使用项目需求或 Bug。`usage` 读取会话累计用量与费用；`queued-inputs` 仅显示本人尚未投递的消息，`withdraw-input` 成功后返回原稿，已被运行领取的消息不能撤回。

新增命令的完整清单见 [V0.8 逐操作覆盖](WEB-COVERAGE.md)。复杂请求用 `--file <path>` 提交 JSON，筛选参数用 `--query-file <path>`。具体字段见各命令 `--help` 中的接口契约。游标列表用 `--cursor` 读取下一页，或用 `--all` 逐页收集。跟踪模式持续输出文本，分页查询可用 `--json`。

节点创建和轮换要求 `--token-out <path>`，命令将一次性令牌写入新文件，权限为 `0600`。新建或轮换的凭据值、模型 API Key 及储存桶密钥用 `--file -` 从标准输入读取。使用文件或环境中的个人 Token 为这些请求认证。

升级服务端后，已签发的 API Token 会继承账号可以执行的新增操作，含项目恢复及储存桶管理。个人 GitHub 绑定和模型订阅授权在 Web 发起。`git account status` 和 `bot model list` 可查询当前状态。授权范围及保留的 Web 操作见 [V0.8 规格](../../specs/011-v08-cli-business-parity/spec.md#2-授权与调用)。

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

## 项目写能力命令

```bash
# 项目写能力
devops tool capabilities --project <id>
devops tool grants add --project <id> --user <userId> --capability code_change
devops tool grants revoke --project <id> --grant <grantId> --yes
devops tool code-change create --project <id> --repository <id> --base main --branch feature/x \
  --message "..." --patch-file ./change.patch --validation-workflow .devops/workflows/validate.yml
devops tool code-change list|show|diff|cancel <codeChangeId>
devops tool pr <codeChangeId> --title "..." [--body-file -]
devops tool issue create --project <id> --bug <bugId> --repository <id> --title "..."
devops tool comment add --project <id> (--bug <id> | --requirement <id> | --remote-issue <n> --repository <id>) \
  --body-file -
```

- 取消受控代码修改和撤销授权要求 `--yes`；写请求默认生成幂等键，可用全局 `--idempotency-key` 覆盖。
- 未验证：真实 Gitea 写操作。

Bot 执行时使用运行级令牌，通过 `DEV_OPS_TOKEN`（或标准输入）读取；该格式不接受从本地配置恢复。令牌只在绑定的运行租约有效期间可用，执行结束、停止或租约失效后，服务端拒绝后续请求。平台发布同时部署相同版本的 CLI。
