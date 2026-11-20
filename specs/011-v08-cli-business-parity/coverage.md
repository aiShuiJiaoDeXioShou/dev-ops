# V0.8 CLI 逐操作覆盖

本表列出 V0.8 新增和扩展的操作。每个命令的 `--help` 列出参数及可用的 OpenAPI 请求契约，浏览器专用操作见 [版本规格](spec.md#1-业务范围)。

| 命令 | 操作 |
| --- | --- |
| `devops pipeline workflow list` | 列出项目工作流 |
| `devops pipeline workflow get` | 读取工作流详情与解析结果 |
| `devops pipeline run trigger` | 按版本引用触发指定工作流 |
| `devops pipeline run list` | 列出项目运行 |
| `devops pipeline run get` | 查询运行、步骤和产物详情 |
| `devops pipeline run cancel` | 请求取消流水线运行 |
| `devops pipeline run wait` | 等待运行完成 |
| `devops pipeline run logs` | 读取日志页或持续跟踪日志 |
| `devops pipeline artifact list` | 列出一次运行的产物 |
| `devops pipeline artifact download` | 校验摘要后下载产物 |
| `devops pipeline node list` | 列出当前团队的执行节点 |
| `devops pipeline node create` | 创建节点，注册令牌只写入指定文件 |
| `devops pipeline node drain` | 排空执行节点 |
| `devops pipeline node disable` | 停用执行节点 |
| `devops pipeline node rotate-token` | 轮换节点令牌并写入文件 |
| `devops delivery artifact list` | 列出项目产物 |
| `devops delivery version list` | 列出服务在各环境的已确认版本 |
| `devops delivery version confirm` | 确认指定环境的实际运行版本 |
| `devops delivery review list` | 列出项目审核记录 |
| `devops delivery review get` | 查询审核记录详情 |
| `devops delivery review create` | 登记外部提审 |
| `devops delivery review update` | 更新审核状态 |
| `devops delivery release list` | 列出项目发布记录 |
| `devops delivery release create` | 登记实际发布结果 |
| `devops project activity` | 读取团队项目晴雨表数据 |
| `devops project repository-options` | 列出团队可用于筛选项目的仓库 |
| `devops project service list` | 列出项目服务 |
| `devops project service get` | 查询项目服务 |
| `devops project service create` | 创建项目服务 |
| `devops project service update` | 编辑、停用或恢复服务 |
| `devops project recycle-bin list` | 列出当前团队回收站中的项目 |
| `devops project recycle-bin restore` | 恢复已删除项目 |
| `devops project list` | 列出当前团队项目，支持搜索、状态筛选与分页 |
| `devops project update` | 编辑项目资料或状态；状态变更必须提供 --reason，默认读取当前版本 |
| `devops requirement create` | 创建需求，正文从文件或标准输入读取，或提供外部文档链接 |
| `devops requirement update` | 编辑需求允许修改的字段；使用 --expected-version 防止覆盖他人更新 |
| `devops requirement submit-test` | 需求提测；需要测试负责人、测试范围与自测结论 |
| `devops bug list` | 列出项目 Bug，支持搜索、状态、负责人不可用筛选与分页 |
| `devops bug create` | 创建 Bug，支持关联需求、指定修复负责人 |
| `devops bug update` | 编辑 Bug 允许修改的字段 |
| `devops attachment policy` | 查询附件上传与绑定限制 |
| `devops attachment upload` | 上传临时附件并返回可绑定的附件 ID |
| `devops attachment download` | 校验摘要后下载附件 |
| `devops attachment remove` | 删除附件 |
| `devops conversation list` | 列出当前团队可见会话 |
| `devops conversation get` | 读取会话详情 |
| `devops conversation create` | 创建私聊或群聊 |
| `devops conversation update` | 更新群聊名称、职责或指令 |
| `devops conversation member add` | 添加群聊成员 |
| `devops conversation member remove` | 移除群聊成员 |
| `devops conversation settings` | 设置会话内模型与思考等级 |
| `devops conversation compact` | 手动压缩会话上下文 |
| `devops conversation stop` | 停止智能体运行 |
| `devops conversation relay continue` | 继续暂停的接力 |
| `devops conversation relay end` | 结束接力 |
| `devops conversation relay stop` | 停止接力及当前运行 |
| `devops conversation messages` | 按游标查询会话消息 |
| `devops conversation send` | 发送消息，支持提及、提示模板和运行中追加 |
| `devops conversation edit-resend` | 编辑私聊中的消息并重新生成 |
| `devops conversation feedback` | 提交回复评价 |
| `devops conversation switch-branch` | 切换消息分支 |
| `devops conversation fork` | 从现有消息派生一个会话 |
| `devops conversation events` | 查询或跟踪会话事件和运行轨迹 |
| `devops task inbox` | 查询当前团队待处理任务 |
| `devops task get` | 查询任务、运行和验收详情 |
| `devops task list` | 列出会话任务 |
| `devops task create` | 创建会话任务并交给执行智能体 |
| `devops task append` | 追加任务指令 |
| `devops task handoff` | 转交任务给另一智能体 |
| `devops task rerun` | 重新运行任务 |
| `devops task cancel` | 取消任务 |
| `devops task stop` | 停止任务的一次运行 |
| `devops task accept` | 验收任务结果 |
| `devops task request-changes` | 退回任务结果并填写修改要求 |
| `devops work-tag list` | 列出团队工作标签 |
| `devops work-tag create` | 创建团队工作标签 |
| `devops work-tag rename` | 重命名工作标签 |
| `devops work-tag remove` | 删除工作标签及其关联 |
| `devops work-tag link` | 为事项添加标签 |
| `devops work-tag unlink` | 解除事项标签关联 |
| `devops bot list` | 列出当前团队的智能体 |
| `devops bot get` | 查看智能体配置 |
| `devops bot create` | 新建智能体 |
| `devops bot update` | 编辑智能体与技能配置 |
| `devops bot bind-model` | 为智能体绑定模型 |
| `devops bot set-access` | 修改智能体工具访问权限 |
| `devops bot enable` | 启用智能体 |
| `devops bot disable` | 停用智能体 |
| `devops bot model catalog` | 查看团队可用的模型目录 |
| `devops bot model list` | 列出模型连接及订阅状态 |
| `devops bot model create` | 用凭据库引用或标准输入中的 API Key 创建模型连接 |
| `devops bot model enable` | 启用模型连接 |
| `devops bot model disable` | 停用模型连接 |
| `devops bot mcp list` | 列出当前团队的 MCP 服务 |
| `devops bot mcp create` | 新建远程 MCP 连接 |
| `devops bot mcp update` | 更新远程 MCP 连接 |
| `devops bot mcp test` | 检测已配置的 MCP 服务 |
| `devops bot mcp enable` | 启用 MCP 服务 |
| `devops bot mcp disable` | 停用 MCP 服务 |
| `devops bot mcp remove` | 删除 MCP 服务 |
| `devops bot memory list` | 查询智能体记忆 |
| `devops bot memory create` | 创建智能体记忆 |
| `devops bot memory update` | 修改记忆正文或常驻状态 |
| `devops bot memory remove` | 删除智能体记忆 |
| `devops bot memory consolidate` | 触发长期记忆整理 |
| `devops bot template list` | 列出团队提示词模板 |
| `devops bot template create` | 新建团队提示词模板 |
| `devops bot template update` | 编辑团队提示词模板 |
| `devops bot template remove` | 删除团队提示词模板 |
| `devops bot context get` | 查看团队上下文 |
| `devops bot context update` | 编辑团队上下文 |
| `devops bot usage` | 查询团队或指定智能体的用量与预算 |
| `devops bot budget update` | 设置或清除团队的月度预算 |
| `devops skill list` | 列出团队技能 |
| `devops skill get` | 查询技能详情 |
| `devops skill create` | 创建团队技能 |
| `devops skill update` | 编辑技能及资源文件 |
| `devops skill enable` | 启用技能 |
| `devops skill disable` | 停用技能 |
| `devops skill versions` | 列出技能版本 |
| `devops skill version` | 读取技能的某个历史版本 |
| `devops skill activities` | 查询技能操作记录 |
| `devops skill export` | 导出技能包或 SKILL.md |
| `devops team update` | 修改团队资料 |
| `devops git account status` | 查看当前账号的 GitHub 绑定状态 |
| `devops tool invocations` | 查询项目写工具调用记录 |
| `devops credential list` | 列出团队凭据元数据 |
| `devops credential get` | 读取凭据元数据和项目授权 |
| `devops credential create` | 从标准输入创建团队凭据 |
| `devops credential rotate` | 从标准输入读取新值并轮换凭据 |
| `devops credential revoke` | 撤销凭据 |
| `devops credential grant` | 向项目授权使用凭据 |
| `devops credential revoke-grant` | 撤销项目的凭据使用授权 |
| `devops credential usage` | 查询凭据使用记录 |
| `devops project env list` | 读取指定环境的变量 |
| `devops project env create` | 创建环境变量或凭据引用 |
| `devops project env update` | 更新变量或其凭据引用 |
| `devops project env remove` | 删除环境变量 |
| `devops storage bucket list` | 列出平台储存桶 |
| `devops storage bucket create` | 从标准输入创建储存桶 |
| `devops storage bucket update` | 更新指定储存桶 |
| `devops storage bucket test` | 测试储存桶读写连接 |
| `devops storage bucket set-default` | 将指定桶设为平台默认桶 |
| `devops storage bucket remove` | 删除储存桶 |

## 浏览器例外

| Web API 客户端方法 | 保留在 Web 的操作 |
| --- | --- |
| `apiClient.getInvitation`、`apiClient.acceptInvitation` | 打开和接受邮件邀请 |
| `apiClient.listApiTokens`、`apiClient.createApiToken`、`apiClient.revokeApiToken` | 管理个人 API Token |
| `apiClient.authorizeGitHubAccount` | 发起个人 GitHub 绑定 |
| `apiClient.startBotOAuthLogin`、`apiClient.getBotOAuthLogin`、`apiClient.answerBotOAuthLogin`、`apiClient.cancelBotOAuthLogin` | 模型提供方订阅授权 |
| `apiClient.openGitHubRepositoryAction` | 核对权限后跳转 GitHub 编辑或创建 PR |
| `apiClient.revealCredentialValue` | 复验密码后查看凭据明文 |
| `apiClient.removeProject`、`apiClient.cleanupProjectFiles` | 复验密码后删除项目或清理项目文件 |
