# 轻量个人 Bot

这是独立运行的单用户 CLI，使用 pi 的 Agent 循环、DeepSeek 模型和 SQLite。当前按用户确认的首版范围实现，不需要启动 Server 或 PostgreSQL；多运行时与平台 API 集成仍是后续设计。应用不导入其他应用源码。

## 启动

在仓库根目录执行：

```bash
nvm use
pnpm install --frozen-lockfile
cp apps/bot/.env.example apps/bot/.env
```

在 `apps/bot/.env` 填入 `DEEPSEEK_API_KEY`。本地已有配置时保留原文件，避免覆盖密钥。`.env` 已被 Git 忽略，不应提交。随后执行：

```bash
pnpm --dir apps/bot dev chat
pnpm --dir apps/bot dev chat '你好' --session main
pnpm --dir apps/bot dev chat '请记住：我喜欢中文回答' --session main
pnpm --dir apps/bot dev chat '我喜欢什么语言？' --session another
pnpm --dir apps/bot dev chat '你好' --json
```

交互模式输入 `/exit` 退出。相同 `--session` 继续会话，不同名称隔离近期对话。所有会话共享当前数据库中的个人长期记忆。默认使用一个 `.data/bot.sqlite`，不是每个会话一个文件；不同个人 Bot 应使用不同的数据库路径。

Node 版本必须符合根目录 `.nvmrc`，以使用内置 `node:sqlite`。依赖只声明 pi 的 `pi-agent-core` 与 `pi-ai`，无需安装 pi CLI。

## 配置

开发与生产脚本从应用目录的 `.env` 加载配置，已有进程环境变量优先。

| 配置                    | 默认值             | 含义                                                        |
| ----------------------- | ------------------ | ----------------------------------------------------------- |
| `DEEPSEEK_API_KEY`      | 空                 | 模型密钥，对话时必需，本地记忆操作不需要                    |
| `BOT_MODEL`             | `deepseek-flash`   | pi DeepSeek 提供器支持的模型，也可使用 `deepseek-v4-pro`    |
| `BOT_DATABASE_PATH`     | `.data/bot.sqlite` | 相对于启动目录解析；通过上述 pnpm 命令启动时位于 `apps/bot` |
| `BOT_TIMEOUT_MS`        | `120000`           | 单次运行超时，单位毫秒，范围 1000–600000                    |
| `BOT_MAX_OUTPUT_TOKENS` | `2048`             | 每次模型请求输出上限，范围 64–8192                          |

单次运行最多八轮模型请求。取消、超时、输出截断、模型失败或版本冲突时不保存本轮消息和记忆；调用已经发生时仍可能产生模型费用。错误输出只包含安全说明。

## 记忆

模型可以调用三个受限工具：`search_memories`、`remember_memory`、`forget_memory`。默认仅在用户明确要求时保存稳定事实或偏好，不把所有聊天自动转换为长期记忆。当前不提供执行命令、读写文件或调用平台 API 的工具。

也可以离线管理记忆：

```bash
pnpm --dir apps/bot dev memory remember '偏好简洁的中文回答' --essential
pnpm --dir apps/bot dev memory list --json
pnpm --dir apps/bot dev memory forget <记忆ID>
```

每个 Bot 最多 200 条记忆，每条最多 2000 个字符。常驻记忆序列化后的 UTF-8 预算为 4096 字节，每轮注入；普通记忆以关键词包含检索，最多返回十条。目前没有向量搜索、自动摘要、后台提炼或自动过期。明显密钥格式会被拒绝，但这不能识别所有敏感内容。

SQLite 保存会话、完整文本消息及工具调用结果、长期记忆和修订号。仅载入最近十二轮完整对话；记忆新增、更新或遗忘后，后续模型请求从新上下文和权威记忆开始，避免历史中的旧事实覆盖当前记忆。旧消息仍保存在本地数据库，**遗忘不是物理擦除历史**。数据库文件和 `.env` 均为明文，目录和文件已设置本机用户权限，不提供加密或多用户鉴权。

模型运行使用记忆工作副本，网络请求期间不持有数据库事务。成功后用短事务和会话版本、记忆修订号一起提交；并发冲突整轮回滚，不自动重试模型请求。SQLite 使用 WAL，迁移随首次打开执行，不使用外键。备份活跃数据库时需使用 SQLite 备份方式或先停止 Bot，不能只复制主文件忽略 WAL。

## 目录与验证

`src/runtime.ts` 负责 pi 与 DeepSeek；`src/tools.ts` 负责记忆工具；`src/memory.ts` 管理工作副本；`src/storage/` 管理 SQLite 与迁移；`src/bot.ts` 编排成功提交；`src/cli.ts` 处理命令与退出码。

```bash
pnpm prepare:clients
pnpm --dir apps/bot check
pnpm --dir apps/bot test:db
pnpm --dir apps/bot build
pnpm --dir apps/bot start chat '你好'
```

测试不访问公网，不使用真实密钥，覆盖真实 pi 循环、SQLite 重启恢复、并发回滚、遗忘隔离、模型失败及 CLI 行为。退出码为 0（成功）、1（运行失败）、2（参数错误）。

实现参考 [pi Agent](https://github.com/earendil-works/pi/tree/main/packages/agent)、[pi AI](https://github.com/earendil-works/pi/tree/main/packages/ai)、[DeepSeek 模型说明](https://api-docs.deepseek.com/quick_start/pricing/) 和 [Node 24 SQLite](https://nodejs.org/download/release/v24.15.0/docs/api/sqlite.html)。
