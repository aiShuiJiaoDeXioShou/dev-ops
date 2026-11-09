# 外部能力适配器

适配器实现业务模块声明的能力接口，由 `bootstrap` 显式组装，不导入业务模块内部实现，也不在模块中直接实例化。

- `git/`：GitHub、Gitea 的提供方实现；生产认证方向见[外部仓库集成架构](../../../../docs/architecture/external-repositories.md)。
- `mail/`：SMTP 邮件发送实现与测试替身；本地默认 Mailpit，stg 使用 Resend SMTP（见 `apps/server/.env`）。

未接入的提供方不得生成占位实现；能力不可用时返回明确错误，不以空数据或伪成功代替。
