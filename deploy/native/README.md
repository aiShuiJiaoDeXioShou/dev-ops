# Mac mini 原生发布

用于已经在 Mac mini 上运行的 DevOps。平台调度 Agent，Agent 在 macOS 上调用固定的发布脚本。Docker 只用于选择 Linux 执行方式的工作流。

## 安装原生节点

1. 先上线支持 `macmini-deploy` 的平台和数据库迁移。
2. 从团队设置注册能力标签为 `macmini-deploy` 的专用执行节点。把长期节点令牌写入权限为 0600 的宿主环境文件。
3. 将 `release-main.sh` 安装到部署目录的 `scripts/`，使用 [Agent 配置](../../apps/pipeline-agent/.env.example)固定宿主脚本、允许发布的仓库 HTTPS URL 与工作流路径。GitHub URL 包含 `.git` 后缀。
4. 用 launchd 启动 Agent。例如使用 `node --env-file <部署目录>/shared/pipeline-agent.env <部署目录>/current/apps/pipeline-agent/dist/index.js`。仓库和私有 Bot 子模块需同属可读取的 GitHub App 安装。同机可通过 Nginx 的本机地址访问 API。先运行 `corepack enable pnpm`，然后在 launchd 的 `PATH` 中包含 Node、Corepack、pnpm、Git 和宿主工具。可选 `DEVOPS_DEPLOY_GIT_PROXY` 只供 GitHub Git 操作使用。

## 发布

从项目「流水线」手动触发 [`deploy-macmini`](../../.devops/workflows/deploy-macmini.yml)，选择 `main`。只有团队管理员能触发原生发布。节点只支持一次执行一个发布。脚本从固定仓库检出提交，在 macOS 构建，运行数据库迁移，将 `current` 切换到新版本，再重启 API 和两个 Worker。

运行成功以 API 就绪和登录页可访问为准。发布脚本遇到启动或就绪失败时恢复上一版本的应用目录。数据库迁移不会自动回退。Agent 独立守护，发布时保留当前运行及其日志上报，下一次启动时加载 `current` 中的 Agent 产物。
