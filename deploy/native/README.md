# Mac mini 原生发布

用于已经在 Mac mini 上运行的 DevOps。平台调度 Agent，Agent 在 macOS 独立工作区检出源码并执行 YAML 中的 `run` 步骤。Docker 用于 Linux 执行节点。

## 安装原生节点

1. 首次安装使用仓库的 [`.devops/scripts/deploy.sh`](../../.devops/scripts/deploy.sh) 初始化。先上线支持 `macmini-deploy` 的平台和数据库迁移。
2. 从团队设置注册能力标签为 `macmini-deploy` 的专用执行节点。把长期节点令牌写入权限为 0600 的宿主环境文件。
3. 使用 [Agent 配置](../../apps/pipeline-agent/.env.example)设置 `AGENT_NATIVE_DEPLOY_REPOSITORY` 和 `AGENT_NATIVE_DEPLOY_WORKFLOW`，限定生产节点可执行的仓库与工作流。GitHub URL 包含 `.git` 后缀。原生命令以 Agent 的系统账号运行，生产节点仅用于可信的发布工作流。
4. 用 launchd 启动 Agent。例如使用 `node --env-file <部署目录>/shared/pipeline-agent.env <部署目录>/current/apps/pipeline-agent/dist/index.js`。仓库和私有 Bot 子模块需同属可读取的 GitHub App 安装。同机可通过 Nginx 的本机地址访问 API。先运行 `corepack enable pnpm`，然后在 launchd 的 `PATH` 中包含 Node、Corepack、pnpm、Git 和宿主工具。可选 `DEVOPS_DEPLOY_GIT_PROXY` 只供 GitHub Git 操作使用。

### 从旧版工作流升级

先发布支持原生 `run` 且仍使用 `builtin:deploy-native` 的兼容版本。旧流水线完成后，重启 launchd 管理的 Agent，使其加载新版执行器。随后将含 `run` 步骤的工作流发布到 `main`。升级完成后可移除旧版专用配置 `AGENT_NATIVE_DEPLOY_SCRIPT`。

## 发布

从项目「流水线」手动触发 [`deploy-macmini`](../../.devops/workflows/deploy-macmini.yml)，选择 `main`。只有团队管理员能触发原生发布。节点每次执行一个发布，先检出固定提交和子模块，然后通过 `run` 直接调用该提交里的 [`.devops/scripts/release-main.sh`](../../.devops/scripts/release-main.sh)。脚本使用已检出的源码构建，执行数据库迁移、切换 `current`，再重启 API 和两个 Worker。

新安装的 `com.devops.*` 服务按共享配置 `APP_ORIGIN` 检查对外网关。已有 `com.apple-macmini.devops.*` 部署继续通过本机网关端口 `18080` 检查。发布脚本根据 launchd 服务参数核对部署目录后再重启服务。

运行成功以 API 就绪和登录页可访问为准。发布脚本遇到启动或就绪失败时恢复上一版本的应用目录。数据库迁移不会自动回退。Agent 独立守护，发布时保留当前运行及其日志上报，下一次启动时加载 `current` 中的 Agent 产物。

## 生产邮件配置

生产环境通过已验证的 Resend 发件域名 `mail.hehui666.top` 发送团队邀请和密码重置邮件。将 `SMTP_URL` 和 `MAIL_FROM` 写在 Mac mini 部署目录的 `shared/app.env`，文件权限设为 `0600`。当前使用 `smtp.resend.com:465` 的 SMTPS 服务，`MAIL_FROM` 填纯邮箱地址 `noreply@mail.hehui666.top`。SMTP 凭据保存在宿主机的共享配置文件中。

`deploy-macmini` 把新版本构建到 `releases/<提交 SHA>`，切换 `current` 后重启应用。launchd 通过 `--env-file` 读取发布目录外的 `shared/app.env`，因此正常发布和应用版本回滚均保留发件地址及 SMTP 配置。

手动修改发件配置后，以部署用户重启 HTTP API，再检查 `/api/v1/ready`。

```bash
launchctl kickstart -k "gui/$(id -u)/com.apple-macmini.devops.http"
```
