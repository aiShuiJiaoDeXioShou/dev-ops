# Git 适配器

实现 `code` / `integrations` 模块声明的提供方端口，负责来源认证、请求、分页、错误映射和响应转换；不保存平台项目权限，不判断业务状态。

- 生产方向：GitHub App 安装身份（`github.adapter.ts`）；Gitea 服务账号 Token（`gitea.adapter.ts`）。
- 本地/stg：`github-cli.adapter.ts` 通过 `child_process.execFile` 调用已登录的 `gh`，只允许固定命令、超时与输出上限，并用 `GITHUB_ALLOWED_REPOS` 限制仓库范围；当前仅允许 `aiShuiJiaoDeXioShou/dev-ops` 做首轮验证。运行主机必须安装并登录 `gh`，该模式不能替代多团队生产授权模型。
- 切换由 `GITHUB_AUTH_MODE=cli|app` 决定，业务模块只依赖提供方端口，不感知具体适配器。

当前仅初始化目录与决策记录，适配器实现见 T071–T087。

## 实现状态（2026-11-10）

- 已实现只读端口 `git.types.ts`、注册表 `git.registry.ts`，按 `GITHUB_AUTH_MODE` 选择 CLI/App。
- `github-cli.adapter.ts`：`execFile` 固定命令、`GITHUB_ALLOWED_REPOS` 白名单、超时/输出上限、错误分类。
- `github.adapter.ts`：Octokit App 安装身份、仓库分页、Commit/Issue/PR 读取与错误分类。
- `gitea.adapter.ts`：实例基址、服务 Token、分页与错误分类。
- 测试：`apps/server/test/git-adapters.test.ts`。
