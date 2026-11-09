# Server 业务模块

V0.1 按目标架构初始化以下模块目录；实现时按真实需求添加 `routes`、`schema`、`service`、`repository`、`tables`、`public.ts`，不为未使用的能力预建空层。

| 模块          | 职责                                     | 计划任务             |
| ------------- | ---------------------------------------- | -------------------- |
| identity      | 账号、会话、团队、成员、邀请、权限上下文 | T014–T037            |
| projects      | 项目资料、负责人、状态与计数             | T038–T047            |
| requirements  | 需求、协作人员、提测记录与状态流转       | T048–T059、T088–T097 |
| bugs          | Bug、需求关联、修复与回归                | T060–T070            |
| code          | 仓库关系、代码引用与来源核对             | T071–T087            |
| integrations  | Git 连接、授权与提供方注册               | T071–T087            |
| configuration | 加密凭据存取                             | T071                 |
| collaboration | 评论与活动记录                           | T019 及业务模块阶段  |
| health        | 现有进程存活与数据库就绪检查             | 已实现               |

模块之间只通过 `public.ts` 调用；`bootstrap` 负责组装，`platform` 不依赖业务模块。数据库表由所属模块定义并汇总到 `bootstrap/database-schema.ts`。

V0.2+ 的 delivery、bots、tasks、knowledge、operations、monitoring、notifications 等目录在对应功能进入开发时再创建。
