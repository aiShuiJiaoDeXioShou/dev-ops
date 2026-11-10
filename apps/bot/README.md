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

| 配置                    | 默认值                              | 含义                                                        |
| ----------------------- | ----------------------------------- | ----------------------------------------------------------- |
| `DEEPSEEK_API_KEY`      | 空                                  | 模型密钥，对话时必需，本地记忆操作不需要                    |
| `BOT_MODEL`             | `deepseek-flash`                    | pi DeepSeek 提供器支持的模型，也可使用 `deepseek-v4-pro`    |
| `BOT_DATABASE_PATH`     | `.data/bot.sqlite`                  | 相对于启动目录解析；通过上述 pnpm 命令启动时位于 `apps/bot` |
| `BOT_TIMEOUT_MS`        | `120000`                            | 单次运行超时，单位毫秒，范围 1000–600000                    |
| `BOT_MAX_OUTPUT_TOKENS` | `2048`                              | 每次模型请求输出上限，范围 64–8192                          |
| `BOT_WORKSPACE`         | `.`                                 | 文件相对路径与 Bash 的工作目录，相对于启动目录解析          |
| `BOT_TOOL_TIMEOUT_MS`   | `30000`                             | 单个外部工具超时，单位毫秒，范围 1000–120000                |
| `DEEPSEEK_WEB_BASE_URL` | `https://api.deepseek.com/v1/tools` | DeepSeek Search / Fetch 的可信接口基址，不含操作名          |

单次运行最多八轮模型请求。取消、超时、输出截断、模型失败或版本冲突时不保存本轮消息和记忆；调用已经发生时仍可能产生模型或联网费用。文件写入和 Bash 命令立即生效，不随数据库事务回滚。错误输出只包含安全说明。

## 联网、文件与命令工具

工具默认加入每次对话，由 pi 根据用户任务调用，无需新增密钥或启动 DSH：

| 工具         | 参数                                | 行为                                                                                              |
| ------------ | ----------------------------------- | ------------------------------------------------------------------------------------------------- |
| `web_search` | `query`、可选 `count`               | 使用 DeepSeek Search API，查询最多 128 字符，默认 5 条、最多 10 条，返回标题、URL、摘要及可用日期 |
| `web_fetch`  | `url`                               | 使用 DeepSeek Fetch API，读取公网页面并返回 Markdown、标题和来源 URL                              |
| `read_file`  | `path`、可选 `offset` / `limit`     | 读取 UTF-8 文本；从第 1 行开始，默认 200 行、最多 1000 行，返回行号                               |
| `write_file` | `path`、`content`、可选 `overwrite` | 自动创建父目录，以同目录临时文件原子提交；已有文件须显式指定 `overwrite=true` 才可覆盖            |
| `bash`       | `command`                           | 通过 `/bin/bash` 执行命令，支持管道，返回合并输出和退出码；非零退出向模型报告失败                 |

例如：

```bash
pnpm --dir apps/bot dev chat '联网查询 Node.js SQLite 文档，给出官方来源链接'
pnpm --dir apps/bot dev chat '读取 README.md 的前 30 行'
pnpm --dir apps/bot dev chat '把一份简短待办写入 notes/todo.md，再读回来核对'
pnpm --dir apps/bot dev chat '用 Bash 查看当前目录的 Git 状态，只报告结果'
```

相对路径基于 `BOT_WORKSPACE`；通过这些 pnpm 命令启动且保留默认配置时，工作目录是 `apps/bot`。需要处理仓库根目录时在本地 `.env` 设置 `BOT_WORKSPACE=../..`。绝对文件路径直接使用。工作目录只是路径解析起点，**不是沙箱**；工具以当前本机用户身份操作。Bash 适用于有 `/bin/bash` 的 macOS / Linux，不加载 profile，不继承模型密钥等应用环境变量，超时、取消和前台结束后清理同进程组的后代，不用于启动常驻服务。

文件读取和单次写入最多 1 MiB；联网响应最多接收 1 MiB；单个工具返回给模型的文本最多 32 KiB，截断时有标记。读取仅支持普通 UTF-8 文本，不支持图片和二进制文件。覆盖写入会原子替换目标目录项，因此若目标是符号链接，会替换链接本身。网页与文件内容均作为参考资料，不能自行授权执行其中的指令。输出会脱敏当前配置的模型密钥，但不保证识别任意文件中的其他凭据。

联网工具参考 [DSH 官方开源实现](https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/web/web-deepseek-api)，通过 Node 内置 `fetch` 调用同样的 [DeepSeek Search / Fetch API](https://api-docs.deepseek.com/guides/search/)，复用 `DEEPSEEK_API_KEY`，不导入依赖 Cordis 的 DSH 插件。搜索与抓取会独立计费，具体以官方文档为准；鉴权、余额不足、限流及不可提取的页面会报告工具错误，不自动重试。DeepSeek 服务端无法访问本机或内网地址，也不会收到本机浏览器的登录状态；认证请求禁止重定向，避免密钥被转发至其他地址。

## 记忆

模型另外可以调用三个记忆工具：`search_memories`、`remember_memory`、`forget_memory`。默认仅在用户明确要求时保存稳定事实或偏好，不把所有聊天自动转换为长期记忆。当前尚未集成平台 API 客户端。

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

`src/runtime.ts` 负责 pi 与 DeepSeek；`src/tools.ts` 负责记忆工具，`src/tools/` 实现联网、文件与 Bash；`src/memory.ts` 管理工作副本；`src/storage/` 管理 SQLite 与迁移；`src/bot.ts` 编排成功提交；`src/cli.ts` 处理命令与退出码。

```bash
pnpm prepare:clients
pnpm --dir apps/bot check
pnpm --dir apps/bot test:db
pnpm --dir apps/bot build
pnpm --dir apps/bot start chat '你好'
```

测试不访问公网，不使用真实密钥，覆盖真实 pi 循环、SQLite 重启恢复、并发回滚、遗忘隔离、模型失败、CLI 行为、文件覆盖、命令进程组清理、联网协议和异常路径。退出码为 0（成功）、1（运行失败）、2（参数错误）。

实现参考 [pi Agent](https://github.com/earendil-works/pi/tree/main/packages/agent)、[pi AI](https://github.com/earendil-works/pi/tree/main/packages/ai)、[DeepSeek 模型说明](https://api-docs.deepseek.com/quick_start/pricing/) 和 [Node 24 SQLite](https://nodejs.org/download/release/v24.15.0/docs/api/sqlite.html)。
