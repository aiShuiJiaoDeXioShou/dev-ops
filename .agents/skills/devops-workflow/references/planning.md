# 规划说明

## 待办

`devops work task add` 只追加待办，适合大多数需求：

```sh
devops work task add "数据库迁移：project_member 增加角色" "成员接口校验角色" "成员页增加角色列"
devops work task list
devops work task done t1
devops work task undo t1
```

- 事项没有规划节点时，命令创建 `develop`（开发）节点；已有节点时追加到第一个节点，用 `--node <节点ID>` 指定其他节点。
- 待办编号按 `t1`、`t2` 顺序分配，删除或改名用下面的完整规划。

## 完整规划

需要多个阶段、排期或调整已有待办时，读出规划，修改后整体写回：

```sh
devops requirement get <需求ID> --json > requirement.json   # data.plan 是当前规划
devops requirement update <需求ID> --plan-file plan.json
```

`plan.json` 是节点数组，最多 24 个节点，每个节点最多 30 个待办：

```json
[
  {
    "id": "develop",
    "title": "开发",
    "startsOn": "2026-12-01",
    "endsOn": "2026-12-03",
    "tasks": [{ "id": "t1", "title": "成员接口校验角色", "startsOn": null, "endsOn": null, "done": false }]
  },
  { "id": "verify", "title": "验证", "startsOn": null, "endsOn": null, "tasks": [] }
]
```

- `id` 只能用小写字母、数字、`-`、`_`，同一事项内节点和待办的 `id` 都不能重复。
- 日期为 `YYYY-MM-DD` 或 `null`，结束日期不能早于开始日期。
- Bug 用 `devops bug update <BugID> --plan-file plan.json`。

## 拆分示例

需求“项目成员支持角色”涉及迁移、后端和前端，拆成：

1. `数据库迁移：project_member 增加 role 字段`，对应一个 `feat(project)` 提交。
2. `成员接口按角色校验写权限`，后端提交，含权限测试。
3. `api-client 重新生成并更新 CLI 成员命令`，共享客户端提交。
4. `成员页展示和修改角色`，前端提交，按 UI 验收要求上传截图。

只改一处文案或一个函数的需求不拆分，直接实施和交付。
