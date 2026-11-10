# delivery 模块

承载 V0.2 的构建记录、产物引用、服务运行版本、流水线运行记录与外部审核/发布记录。

- 路由：`delivery.routes.ts`，仅 GET/POST，统一 HTTP 200 信封。
- 业务规则：`delivery.service.ts` 负责构建上报与组合各领域用例；产物入口、运行版本、流水线与审核/发布分别位于 `delivery.artifact.service.ts`、`delivery.run-version.service.ts`、`delivery.pipeline.service.ts`、`delivery.review.service.ts`；校验与枚举：`delivery.validators.ts`；视图分页：`delivery.view.ts`。
- 持久化：`delivery.tables.ts` 与各领域 `*.repository.ts`；无数据库外键。
- 边界：提测与产物/流水线完全解耦；平台不托管产物文件、不执行流水线、不自动提交或同步外部审核；重复上报按业务唯一键幂等；流水线旧上报不覆盖较新状态；运行版本只由明确确认动作变化；审核通过不自动生成发布记录；历史记录只增不改。
