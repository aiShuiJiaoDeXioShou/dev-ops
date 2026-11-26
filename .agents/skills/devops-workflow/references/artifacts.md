# 产物上传

过程产物要留在事项里，供评审、测试和后续接手的人查看。用 `devops work attach` 上传，已有附件会保留。

| 产物 | `--kind` | 何时上传 |
| ---- | -------- | -------- |
| 设计稿、交互原型（HTML、图片） | `design` | 方案确定后、开始实现前；方案调整后上传新版本 |
| 界面截图（AGENTS.md UI 验收要求的视口） | `screenshot` | UI 改动完成验收时 |
| 测试报告、性能数据、执行计划输出 | `report` | 交付前 |
| 其他说明文件 | `other` | 需要时 |

```sh
devops work attach ./docs/design/member-role.html --kind design --note "成员角色设计稿，评审后定稿"
devops work attach ./shots/member-1440.png ./shots/member-390.png --kind screenshot --note "1440×1000 与 390×844"
devops work attach ./reports/explain.txt --kind report
```

- 前三种用途会在文件名前加“设计稿-”“截图-”“测试报告-”。
- 单个事项最多绑定 10 个附件，单文件大小受服务端策略限制（`devops attachment policy`）。超出时先在 Web 端整理旧附件，或把多张截图合成一张。
- HTML 设计稿目前在 Web 端以源码预览，需要下载后在浏览器打开；渲染预览由需求 REQ-12 提供。
- 不上传包含密钥、真实凭据或用户个人数据的文件。截图前确认页面上没有真实账号信息。
- 设计稿需要随代码演进时，同时保存在仓库内（例如 `docs/design/`），附件只作为当时的快照。
