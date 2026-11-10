# pipeline-agent 执行节点

V0.4a 自托管执行节点 Agent。Agent 主动外连平台，领取租约后在节点 Docker 中执行平台生成并固定的运行计划，回传步骤状态、日志与产物。Agent **不解析 YAML、不修改运行计划中的镜像/命令/环境引用**。

## 职责与边界

- 注册：使用一次性注册令牌换取节点长期令牌；令牌只保存在内存，不写磁盘、不打印。
- 心跳（默认 15 秒）与续约（约 30 秒）：上报当前租约与能力标签，接收平台取消下发。
- 执行：在隔离工作区用租约内短期 Git 凭据检出固定提交，在单个非 root Linux 容器内串行执行 job/step。
- 回传：步骤状态、日志分片（单次 ≤20 片、总量 ≤256 KB）、产物 tar（SHA-256 与大小随请求头校验）。
- 安全：容器限制 CPU/内存/进程数、禁用提权、不挂载宿主机 Docker socket；日志上传前脱敏一层。
- 收口：取消、步骤/运行超时、租约失效都会终止容器并清理工作区；清理失败随完成上报。
- 启动自愈：清理上次进程被强杀时遗留的 `devops.agent.managed=true` 任务容器与运行工作区；清理失败只告警，不阻塞启动。

协议见 `specs/005-v04a-pipeline-runner/contracts/agent-protocol.md`，运行计划类型见 `packages/pipeline-protocol`。

## 前置条件

- Node.js 24、pnpm 11（以仓库 `.nvmrc` 与根 `package.json` 为准）。
- 可访问平台 API 的网络。
- 节点 Docker Engine（本机 Docker 29 验证通过）；Agent 进程用户需要访问 Docker socket 的权限。
- 团队管理员已在平台创建执行节点，并拿到一次性注册令牌与能力标签。

## 配置

复制 `.env.example` 为本地配置并按需修改；必需项：

| 变量                                        | 说明                                                    |
| ------------------------------------------- | ------------------------------------------------------- |
| `PLATFORM_URL`                              | 平台 API 地址，含协议与端口，如 `http://127.0.0.1:3001` |
| `AGENT_REGISTRATION_TOKEN` 或 `AGENT_TOKEN` | 二选一；首次注册用一次性令牌，之后改用长期令牌          |
| `AGENT_WORK_DIR`                            | 宿主工作根目录，运行工作区与临时产物在其下创建          |
| `AGENT_LABELS`                              | 能力标签，逗号分隔，需与平台节点配置匹配                |

其余可选项（`AGENT_NAME`、轮询/超时、容器资源限制、`AGENT_CONTAINER_USER`、`AGENT_DOCKER_SOCKET`）见 `.env.example` 注释。配置缺失或非法时进程以非零码退出并输出可读错误。

## 启动

```bash
# 开发（tsx 直接运行，读取进程环境变量）
pnpm --dir apps/pipeline-agent dev

# 构建后运行
pnpm --dir apps/pipeline-agent build
node apps/pipeline-agent/dist/index.js
```

启动顺序：校验配置 → 创建工作目录 → 检查 Docker 可用性 → 清理遗留任务容器 → 清理遗留工作区 → 注册/复用令牌 → 心跳与租约循环。收到 `SIGINT`/`SIGTERM` 时停止领取新任务，并把当前租约按 `interrupted` 收口（尽力而为）。

建议用 systemd 或容器编排守护进程；Agent 崩溃后重新启动会继续清理遗留工作区。

## 验证与测试

```bash
pnpm --dir apps/pipeline-agent typecheck
pnpm --dir apps/pipeline-agent lint
pnpm --dir apps/pipeline-agent test
pnpm --dir apps/pipeline-agent build
```

- 单元测试使用本地 mock HTTP server，不依赖公网。
- 执行器与取消/超时测试使用真实 Docker；Docker 不可用时显式 skip 并在输出中说明，不会伪造通过。
- 集成测试镜像可通过 `AGENT_TEST_IMAGE` 覆盖（默认 `node:24-bookworm-slim`）。

## 排障

| 现象                                        | 排查                                                                 |
| ------------------------------------------- | -------------------------------------------------------------------- |
| 启动即退出：缺少必需配置                    | 检查 `PLATFORM_URL`、令牌与 `AGENT_WORK_DIR`                         |
| `Docker 不可用`                             | 确认 Docker Engine 运行且当前用户可访问 socket                       |
| 注册失败 `AGENT_REGISTRATION_TOKEN_INVALID` | 令牌已使用/过期/撤销，需在平台重新生成                               |
| 一直不领取任务                              | 节点 `draining`/`disabled`/离线，或能力标签与 `runs-on` 不匹配       |
| 取消后仍显示运行中                          | 节点未响应，平台会在租约过期后收口为 `interrupted`，不会显示成功     |
| 日志/产物上传失败                           | 检查平台可达性、大小限制与本地磁盘；详见 Agent stderr 日志（已脱敏） |
