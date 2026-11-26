# 查询与发布

## 核对服务与项目

```sh
devops whoami --json
devops project list --search devops --json
devops project repository list <项目ID> --json
```

项目名可能重复，写操作使用确认过的项目 ID。凭据配置见 [CLI 说明](../../../../apps/cli/README.md)，令牌只从本机配置、环境变量或标准输入提供。

## 查询事项

```sh
devops requirement list --project <项目ID> --status in_development --json
devops requirement get <需求ID> --json
devops bug list --project <项目ID> --json
```

改状态前先查详情。复杂请求按对应命令的 `--help` 传 JSON。

## 流水线

```sh
devops pipeline workflow list <项目ID> --json
devops pipeline run trigger <项目ID> --workflow .devops/workflows/ci.yml --ref main --json
devops pipeline run wait <运行ID> --json
devops pipeline run logs <运行ID> --step 1
```

发布成功以运行终态和线上健康检查为准。

## 发布本仓库到 Mac mini

仅在用户要求上线本仓库时，从 `main` 触发 `.devops/workflows/deploy-macmini.yml`。先核对仓库最新提交和节点在线，完成后比对运行的 `commitSha` 与待发布提交。原生节点的启动和发布方式见 [Mac mini 原生发布](../../../../deploy/native/README.md)。

```sh
devops pipeline node list --json
devops pipeline run trigger <项目ID> --workflow .devops/workflows/deploy-macmini.yml --ref main --json
devops pipeline run wait <运行ID> --json
devops ready --json
```
