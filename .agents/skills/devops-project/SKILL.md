---
name: devops-project
description: 使用本机 devops CLI 管理 DevOps 平台里已经接入的项目，查询或维护需求、缺陷、交付和流水线。此仓库的 Mac mini 自举发布也使用该入口。
---

# 使用 DevOps 管理项目

先运行 `devops whoami --json` 和 `devops project list --search <项目名> --json`，核对当前服务、团队、项目和关联仓库。项目名可能重复，写操作用确认过的项目 ID。配置凭据见 [CLI 说明](../../../apps/cli/README.md)。

- 用 `devops requirement list --project <项目ID> --json` 和 `devops bug list --project <项目ID> --json` 查找事项，改状态前先查详情。复杂请求按对应命令的 `--help` 传 JSON。令牌只从本机配置、环境变量或标准输入提供。
- 用 `devops pipeline workflow list <项目ID> --json` 读取 Git 仓库里的工作流，再用 `pipeline run trigger`、`pipeline run get`、`pipeline run logs` 和 `pipeline run wait` 获取执行结果。发布成功以运行终态和线上健康检查为准。
- 仅在用户要求上线本仓库时，从 `main` 触发 `.devops/workflows/deploy-macmini.yml`。先核对仓库最新提交和节点在线，完成后比对运行的 `commitSha` 与待发布提交。原生节点的启动和发布方式见 [Mac mini 原生发布](../../../deploy/native/README.md)。

```sh
devops pipeline node list --json
devops pipeline run trigger <项目ID> --workflow .devops/workflows/deploy-macmini.yml --ref main --json
devops pipeline run wait <运行ID> --json
devops ready --json
```
