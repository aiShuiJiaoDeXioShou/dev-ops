CREATE TABLE "app"."change_execution" (
	"id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"plan_revision" integer NOT NULL,
	"attempt" integer NOT NULL,
	"execution_mode" text NOT NULL,
	"status" text NOT NULL,
	"pipeline_run_id" uuid,
	"external_ref" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"error_code" text,
	"error_message" text,
	"verification_status" text DEFAULT 'pending' NOT NULL,
	"health_status" text,
	"expected_version_label" text NOT NULL,
	"actual_version_label" text,
	"verification_evidence" jsonb,
	"verified_by_user_id" uuid,
	"verified_at" timestamp with time zone,
	"verification_note" text,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_change_execution_id" PRIMARY KEY("id"),
	CONSTRAINT "uk_change_execution_attempt" UNIQUE("plan_id","attempt"),
	CONSTRAINT "ck_change_execution_attempt" CHECK ("app"."change_execution"."attempt" >= 1),
	CONSTRAINT "ck_change_execution_mode" CHECK ("app"."change_execution"."execution_mode" in ('platform_pipeline', 'external_system')),
	CONSTRAINT "ck_change_execution_status" CHECK ("app"."change_execution"."status" in ('queued', 'running', 'succeeded', 'failed', 'interrupted', 'timed_out', 'unverified')),
	CONSTRAINT "ck_change_execution_verification" CHECK ("app"."change_execution"."verification_status" in ('pending', 'passed', 'failed')),
	CONSTRAINT "ck_change_execution_health" CHECK ("app"."change_execution"."health_status" is null or "app"."change_execution"."health_status" in ('ok', 'failing', 'unknown')),
	CONSTRAINT "ck_change_execution_run" CHECK (("app"."change_execution"."execution_mode" = 'platform_pipeline' and "app"."change_execution"."pipeline_run_id" is not null) or "app"."change_execution"."execution_mode" = 'external_system')
);
--> statement-breakpoint
CREATE TABLE "app"."change_plan" (
	"id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"service_id" uuid,
	"target_resource" text NOT NULL,
	"environment" text NOT NULL,
	"operation_kind" text NOT NULL,
	"status" text NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"version_label" text NOT NULL,
	"scope_summary" text NOT NULL,
	"evidence" text NOT NULL,
	"rollback_plan" text NOT NULL,
	"execution_mode" text NOT NULL,
	"workflow_path" text,
	"workflow_ref" text,
	"pipeline_inputs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"approved_by_user_id" uuid,
	"approved_at" timestamp with time zone,
	"approved_revision" integer,
	"active_execution_id" uuid,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"error_code" text,
	"error_message" text,
	"created_by_user_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_change_plan_id" PRIMARY KEY("id"),
	CONSTRAINT "ck_change_plan_environment" CHECK ("app"."change_plan"."environment" in ('development', 'test', 'production')),
	CONSTRAINT "ck_change_plan_operation" CHECK ("app"."change_plan"."operation_kind" in ('deploy_version', 'database_change', 'server_cleanup', 'cloud_resource_change')),
	CONSTRAINT "ck_change_plan_status" CHECK ("app"."change_plan"."status" in ('pending', 'approved', 'executing', 'verifying', 'completed', 'failed', 'cancelled')),
	CONSTRAINT "ck_change_plan_mode" CHECK ("app"."change_plan"."execution_mode" in ('platform_pipeline', 'external_system')),
	CONSTRAINT "ck_change_plan_deploy_target" CHECK (("app"."change_plan"."operation_kind" = 'deploy_version' and "app"."change_plan"."service_id" is not null and "app"."change_plan"."workflow_path" is not null) or ("app"."change_plan"."operation_kind" <> 'deploy_version' and "app"."change_plan"."service_id" is null)),
	CONSTRAINT "ck_change_plan_revision" CHECK ("app"."change_plan"."revision" >= 1),
	CONSTRAINT "ck_change_plan_version" CHECK ("app"."change_plan"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "app"."change_plan_approval" (
	"id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"plan_revision" integer NOT NULL,
	"plan_snapshot" jsonb NOT NULL,
	"approved_by_user_id" uuid NOT NULL,
	"approved_at" timestamp with time zone NOT NULL,
	"invalidated_at" timestamp with time zone,
	"invalidated_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_change_plan_approval_id" PRIMARY KEY("id"),
	CONSTRAINT "uk_change_plan_approval_revision" UNIQUE("plan_id","plan_revision")
);
--> statement-breakpoint
CREATE TABLE "app"."change_plan_event" (
	"id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"execution_id" uuid,
	"event_type" text NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"summary" text NOT NULL,
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_change_plan_event_id" PRIMARY KEY("id"),
	CONSTRAINT "ck_change_plan_event_type" CHECK ("app"."change_plan_event"."event_type" in ('created', 'updated', 'approved', 'approval_invalidated', 'execution_started', 'execution_finished', 'verification_failed', 'completed', 'cancelled', 'retry_requested'))
);
--> statement-breakpoint
CREATE TABLE "app"."code_change" (
	"id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"repository_id" uuid NOT NULL,
	"invocation_id" uuid NOT NULL,
	"base_ref" text NOT NULL,
	"base_sha" text NOT NULL,
	"branch_name" text NOT NULL,
	"commit_message" text NOT NULL,
	"author_name" text NOT NULL,
	"author_email" text NOT NULL,
	"patch" text NOT NULL,
	"patch_sha256" text NOT NULL,
	"patch_size_bytes" integer NOT NULL,
	"validation_workflow_path" text NOT NULL,
	"status" text NOT NULL,
	"pipeline_run_id" uuid,
	"diff_storage_key" text,
	"diff_sha256" text,
	"diff_size_bytes" integer,
	"validation_result" jsonb,
	"pull_request_number" integer,
	"pull_request_url" text,
	"error_code" text,
	"error_message" text,
	"finished_at" timestamp with time zone,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_code_change_id" PRIMARY KEY("id"),
	CONSTRAINT "uk_code_change_invocation" UNIQUE("invocation_id"),
	CONSTRAINT "ck_code_change_status" CHECK ("app"."code_change"."status" in ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
	CONSTRAINT "ck_code_change_patch_size" CHECK ("app"."code_change"."patch_size_bytes" > 0 and "app"."code_change"."patch_size_bytes" <= 1048576),
	CONSTRAINT "ck_code_change_branch" CHECK ("app"."code_change"."branch_name" <> "app"."code_change"."base_ref")
);
--> statement-breakpoint
CREATE TABLE "app"."project_capability_grant" (
	"id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"grantee_user_id" uuid NOT NULL,
	"capability" text NOT NULL,
	"granted_by_user_id" uuid NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_project_capability_grant_id" PRIMARY KEY("id"),
	CONSTRAINT "ck_project_capability_grant_capability" CHECK ("app"."project_capability_grant"."capability" in ('code_change', 'create_pull_request', 'create_issue', 'add_comment'))
);
--> statement-breakpoint
CREATE TABLE "app"."tool_invocation" (
	"id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"capability" text NOT NULL,
	"channel" text NOT NULL,
	"status" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"repository_id" uuid,
	"target_ref" text,
	"input_summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"result_ref" jsonb,
	"error_code" text,
	"error_message" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_tool_invocation_id" PRIMARY KEY("id"),
	CONSTRAINT "uk_tool_invocation_idempotency" UNIQUE("project_id","idempotency_key"),
	CONSTRAINT "ck_tool_invocation_capability" CHECK ("app"."tool_invocation"."capability" in ('code_change', 'create_pull_request', 'create_issue', 'add_comment')),
	CONSTRAINT "ck_tool_invocation_channel" CHECK ("app"."tool_invocation"."channel" in ('web', 'cli')),
	CONSTRAINT "ck_tool_invocation_status" CHECK ("app"."tool_invocation"."status" in ('queued', 'running', 'succeeded', 'failed', 'cancelled', 'uncertain'))
);
--> statement-breakpoint
ALTER TABLE "app"."pipeline_run" ADD COLUMN "run_kind" text DEFAULT 'workflow' NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."pipeline_run" ADD COLUMN "secret_environment" text DEFAULT 'production' NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_change_execution_plan" ON "app"."change_execution" USING btree ("plan_id","attempt");--> statement-breakpoint
CREATE INDEX "idx_change_execution_run" ON "app"."change_execution" USING btree ("pipeline_run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uk_change_plan_active_target" ON "app"."change_plan" USING btree ("service_id","environment") WHERE "app"."change_plan"."service_id" is not null and "app"."change_plan"."status" in ('approved', 'executing', 'verifying');--> statement-breakpoint
CREATE INDEX "idx_change_plan_team_time" ON "app"."change_plan" USING btree ("team_id","created_at","id");--> statement-breakpoint
CREATE INDEX "idx_change_plan_project_time" ON "app"."change_plan" USING btree ("project_id","created_at","id");--> statement-breakpoint
CREATE INDEX "idx_change_plan_status" ON "app"."change_plan" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "idx_change_plan_approval_plan" ON "app"."change_plan_approval" USING btree ("plan_id","approved_at","id");--> statement-breakpoint
CREATE INDEX "idx_change_plan_event_plan" ON "app"."change_plan_event" USING btree ("plan_id","created_at","id");--> statement-breakpoint
CREATE INDEX "idx_code_change_project_time" ON "app"."code_change" USING btree ("project_id","created_at","id");--> statement-breakpoint
CREATE INDEX "idx_code_change_run" ON "app"."code_change" USING btree ("pipeline_run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uk_project_capability_grant_active" ON "app"."project_capability_grant" USING btree ("project_id","grantee_user_id","capability") WHERE "app"."project_capability_grant"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "idx_project_capability_grant_user" ON "app"."project_capability_grant" USING btree ("grantee_user_id","team_id","revoked_at");--> statement-breakpoint
CREATE INDEX "idx_project_capability_grant_project" ON "app"."project_capability_grant" USING btree ("project_id","created_at","id");--> statement-breakpoint
CREATE INDEX "idx_tool_invocation_project_time" ON "app"."tool_invocation" USING btree ("project_id","created_at","id");--> statement-breakpoint
CREATE INDEX "idx_tool_invocation_status" ON "app"."tool_invocation" USING btree ("status","created_at");--> statement-breakpoint
ALTER TABLE "app"."pipeline_run" ADD CONSTRAINT "ck_pipeline_run_kind" CHECK ("app"."pipeline_run"."run_kind" in ('workflow', 'code_change'));--> statement-breakpoint
ALTER TABLE "app"."pipeline_run" ADD CONSTRAINT "ck_pipeline_run_secret_environment" CHECK ("app"."pipeline_run"."secret_environment" in ('development', 'test', 'production'));
COMMENT ON TABLE "app"."project_capability_grant" IS '项目写能力授权；按项目、用户与能力授权，撤销保留历史行';
COMMENT ON COLUMN "app"."project_capability_grant"."id" IS '主键（UUID）';
COMMENT ON COLUMN "app"."project_capability_grant"."team_id" IS '所属团队';
COMMENT ON COLUMN "app"."project_capability_grant"."project_id" IS '所属项目';
COMMENT ON COLUMN "app"."project_capability_grant"."created_at" IS '创建时间';
COMMENT ON COLUMN "app"."project_capability_grant"."updated_at" IS '更新时间';
COMMENT ON COLUMN "app"."project_capability_grant"."grantee_user_id" IS '被授权成员';
COMMENT ON COLUMN "app"."project_capability_grant"."capability" IS '能力标识：代码修改/创建 PR/创建 Issue/添加评论';
COMMENT ON COLUMN "app"."project_capability_grant"."granted_by_user_id" IS '授权人';
COMMENT ON COLUMN "app"."project_capability_grant"."revoked_at" IS '撤销时间，空表示有效';
COMMENT ON COLUMN "app"."project_capability_grant"."revoked_by_user_id" IS '撤销人';
COMMENT ON TABLE "app"."tool_invocation" IS '项目写能力调用记录；幂等锚点与审计证据';
COMMENT ON COLUMN "app"."tool_invocation"."id" IS '主键（UUID）';
COMMENT ON COLUMN "app"."tool_invocation"."team_id" IS '所属团队';
COMMENT ON COLUMN "app"."tool_invocation"."project_id" IS '所属项目';
COMMENT ON COLUMN "app"."tool_invocation"."created_at" IS '创建时间';
COMMENT ON COLUMN "app"."tool_invocation"."updated_at" IS '更新时间';
COMMENT ON COLUMN "app"."tool_invocation"."created_by_user_id" IS '创建人';
COMMENT ON COLUMN "app"."tool_invocation"."capability" IS '能力标识';
COMMENT ON COLUMN "app"."tool_invocation"."channel" IS '发起渠道：web 或 cli';
COMMENT ON COLUMN "app"."tool_invocation"."status" IS '调用状态';
COMMENT ON COLUMN "app"."tool_invocation"."idempotency_key" IS '幂等键，项目内唯一';
COMMENT ON COLUMN "app"."tool_invocation"."request_fingerprint" IS '请求指纹（规范化参数摘要）';
COMMENT ON COLUMN "app"."tool_invocation"."repository_id" IS '目标仓库';
COMMENT ON COLUMN "app"."tool_invocation"."target_ref" IS '本地事项或远端记录标识';
COMMENT ON COLUMN "app"."tool_invocation"."input_summary" IS '脱敏后的输入摘要';
COMMENT ON COLUMN "app"."tool_invocation"."result_ref" IS '结果引用（远端标识/URL/编号）';
COMMENT ON COLUMN "app"."tool_invocation"."error_code" IS '失败错误码';
COMMENT ON COLUMN "app"."tool_invocation"."error_message" IS '失败说明';
COMMENT ON COLUMN "app"."tool_invocation"."started_at" IS '开始时间';
COMMENT ON COLUMN "app"."tool_invocation"."finished_at" IS '结束时间';
COMMENT ON TABLE "app"."code_change" IS '受控代码修改请求与结果';
COMMENT ON COLUMN "app"."code_change"."id" IS '主键（UUID）';
COMMENT ON COLUMN "app"."code_change"."team_id" IS '所属团队';
COMMENT ON COLUMN "app"."code_change"."project_id" IS '所属项目';
COMMENT ON COLUMN "app"."code_change"."created_at" IS '创建时间';
COMMENT ON COLUMN "app"."code_change"."updated_at" IS '更新时间';
COMMENT ON COLUMN "app"."code_change"."created_by_user_id" IS '创建人';
COMMENT ON COLUMN "app"."code_change"."repository_id" IS '目标仓库';
COMMENT ON COLUMN "app"."code_change"."invocation_id" IS '对应写能力调用记录';
COMMENT ON COLUMN "app"."code_change"."base_ref" IS '基线分支或标签';
COMMENT ON COLUMN "app"."code_change"."base_sha" IS '基线提交';
COMMENT ON COLUMN "app"."code_change"."branch_name" IS '工作分支';
COMMENT ON COLUMN "app"."code_change"."commit_message" IS '提交信息';
COMMENT ON COLUMN "app"."code_change"."author_name" IS '提交作者名';
COMMENT ON COLUMN "app"."code_change"."author_email" IS '提交作者邮箱';
COMMENT ON COLUMN "app"."code_change"."patch" IS '统一差异补丁，最大 1 MiB';
COMMENT ON COLUMN "app"."code_change"."patch_sha256" IS '补丁 SHA-256';
COMMENT ON COLUMN "app"."code_change"."patch_size_bytes" IS '补丁大小（字节）';
COMMENT ON COLUMN "app"."code_change"."validation_workflow_path" IS '校验收工作流路径';
COMMENT ON COLUMN "app"."code_change"."status" IS '状态：排队/执行中/成功/失败/取消';
COMMENT ON COLUMN "app"."code_change"."pipeline_run_id" IS '执行流水线运行';
COMMENT ON COLUMN "app"."code_change"."diff_storage_key" IS '差异产物存储键';
COMMENT ON COLUMN "app"."code_change"."diff_sha256" IS '差异 SHA-256';
COMMENT ON COLUMN "app"."code_change"."diff_size_bytes" IS '差异大小（字节）';
COMMENT ON COLUMN "app"."code_change"."validation_result" IS '校验结果摘要';
COMMENT ON COLUMN "app"."code_change"."pull_request_number" IS '远端 PR 编号';
COMMENT ON COLUMN "app"."code_change"."pull_request_url" IS '远端 PR 地址';
COMMENT ON COLUMN "app"."code_change"."error_code" IS '失败错误码';
COMMENT ON COLUMN "app"."code_change"."error_message" IS '失败说明';
COMMENT ON COLUMN "app"."code_change"."finished_at" IS '终态时间';
COMMENT ON TABLE "app"."change_plan" IS '变更计划；生产影响操作的权威记录';
COMMENT ON COLUMN "app"."change_plan"."id" IS '主键（UUID）';
COMMENT ON COLUMN "app"."change_plan"."team_id" IS '所属团队';
COMMENT ON COLUMN "app"."change_plan"."project_id" IS '所属项目';
COMMENT ON COLUMN "app"."change_plan"."created_at" IS '创建时间';
COMMENT ON COLUMN "app"."change_plan"."updated_at" IS '更新时间';
COMMENT ON COLUMN "app"."change_plan"."created_by_user_id" IS '创建人';
COMMENT ON COLUMN "app"."change_plan"."service_id" IS '目标服务；部署类必填';
COMMENT ON COLUMN "app"."change_plan"."target_resource" IS '目标服务或资源标识';
COMMENT ON COLUMN "app"."change_plan"."environment" IS '目标环境：开发/测试/生产';
COMMENT ON COLUMN "app"."change_plan"."operation_kind" IS '操作类型';
COMMENT ON COLUMN "app"."change_plan"."status" IS '计划状态';
COMMENT ON COLUMN "app"."change_plan"."revision" IS '内容修订号，实质变更递增';
COMMENT ON COLUMN "app"."change_plan"."version_label" IS '版本或迁移标识';
COMMENT ON COLUMN "app"."change_plan"."scope_summary" IS '变更范围';
COMMENT ON COLUMN "app"."change_plan"."evidence" IS '核对依据';
COMMENT ON COLUMN "app"."change_plan"."rollback_plan" IS '恢复方案';
COMMENT ON COLUMN "app"."change_plan"."execution_mode" IS '执行方式：平台流水线或外部系统';
COMMENT ON COLUMN "app"."change_plan"."workflow_path" IS '部署工作流路径';
COMMENT ON COLUMN "app"."change_plan"."workflow_ref" IS '工作流所在分支或标签';
COMMENT ON COLUMN "app"."change_plan"."pipeline_inputs" IS '执行时固定的流水线输入';
COMMENT ON COLUMN "app"."change_plan"."approved_by_user_id" IS '放行人';
COMMENT ON COLUMN "app"."change_plan"."approved_at" IS '放行时间';
COMMENT ON COLUMN "app"."change_plan"."approved_revision" IS '放行对应的修订号';
COMMENT ON COLUMN "app"."change_plan"."active_execution_id" IS '当前执行尝试';
COMMENT ON COLUMN "app"."change_plan"."started_at" IS '开始执行时间';
COMMENT ON COLUMN "app"."change_plan"."completed_at" IS '完成时间';
COMMENT ON COLUMN "app"."change_plan"."error_code" IS '最近失败错误码';
COMMENT ON COLUMN "app"."change_plan"."error_message" IS '最近失败说明';
COMMENT ON COLUMN "app"."change_plan"."version" IS '并发乐观锁版本';
COMMENT ON TABLE "app"."change_plan_approval" IS '变更计划放行记录；绑定修订与内容快照';
COMMENT ON COLUMN "app"."change_plan_approval"."id" IS '主键（UUID）';
COMMENT ON COLUMN "app"."change_plan_approval"."team_id" IS '所属团队';
COMMENT ON COLUMN "app"."change_plan_approval"."project_id" IS '所属项目';
COMMENT ON COLUMN "app"."change_plan_approval"."created_at" IS '创建时间';
COMMENT ON COLUMN "app"."change_plan_approval"."updated_at" IS '更新时间';
COMMENT ON COLUMN "app"."change_plan_approval"."plan_id" IS '所属变更计划';
COMMENT ON COLUMN "app"."change_plan_approval"."plan_revision" IS '被批准的计划修订号';
COMMENT ON COLUMN "app"."change_plan_approval"."plan_snapshot" IS '批准时的计划内容快照';
COMMENT ON COLUMN "app"."change_plan_approval"."approved_by_user_id" IS '放行人';
COMMENT ON COLUMN "app"."change_plan_approval"."approved_at" IS '放行时间';
COMMENT ON COLUMN "app"."change_plan_approval"."invalidated_at" IS '失效时间';
COMMENT ON COLUMN "app"."change_plan_approval"."invalidated_reason" IS '失效原因';
COMMENT ON TABLE "app"."change_execution" IS '变更执行尝试；一次执行与验证结果';
COMMENT ON COLUMN "app"."change_execution"."id" IS '主键（UUID）';
COMMENT ON COLUMN "app"."change_execution"."team_id" IS '所属团队';
COMMENT ON COLUMN "app"."change_execution"."project_id" IS '所属项目';
COMMENT ON COLUMN "app"."change_execution"."created_at" IS '创建时间';
COMMENT ON COLUMN "app"."change_execution"."updated_at" IS '更新时间';
COMMENT ON COLUMN "app"."change_execution"."created_by_user_id" IS '创建人';
COMMENT ON COLUMN "app"."change_execution"."plan_id" IS '所属变更计划';
COMMENT ON COLUMN "app"."change_execution"."plan_revision" IS '执行依据的计划修订号';
COMMENT ON COLUMN "app"."change_execution"."attempt" IS '尝试序号，从 1 开始';
COMMENT ON COLUMN "app"."change_execution"."execution_mode" IS '执行方式';
COMMENT ON COLUMN "app"."change_execution"."status" IS '执行状态';
COMMENT ON COLUMN "app"."change_execution"."pipeline_run_id" IS '平台流水线运行';
COMMENT ON COLUMN "app"."change_execution"."external_ref" IS '外部执行系统标识';
COMMENT ON COLUMN "app"."change_execution"."started_at" IS '开始时间';
COMMENT ON COLUMN "app"."change_execution"."finished_at" IS '结束时间';
COMMENT ON COLUMN "app"."change_execution"."error_code" IS '失败错误码';
COMMENT ON COLUMN "app"."change_execution"."error_message" IS '失败说明';
COMMENT ON COLUMN "app"."change_execution"."verification_status" IS '验证状态：待验证/通过/失败';
COMMENT ON COLUMN "app"."change_execution"."health_status" IS '健康状态：正常/异常/未知';
COMMENT ON COLUMN "app"."change_execution"."expected_version_label" IS '计划版本';
COMMENT ON COLUMN "app"."change_execution"."actual_version_label" IS '实际运行版本';
COMMENT ON COLUMN "app"."change_execution"."verification_evidence" IS '验证证据摘要';
COMMENT ON COLUMN "app"."change_execution"."verified_by_user_id" IS '验证人';
COMMENT ON COLUMN "app"."change_execution"."verified_at" IS '验证时间';
COMMENT ON COLUMN "app"."change_execution"."verification_note" IS '人工核对说明';
COMMENT ON TABLE "app"."change_plan_event" IS '变更计划事件；只增不改的审计时间线';
COMMENT ON COLUMN "app"."change_plan_event"."id" IS '主键（UUID）';
COMMENT ON COLUMN "app"."change_plan_event"."team_id" IS '所属团队';
COMMENT ON COLUMN "app"."change_plan_event"."project_id" IS '所属项目';
COMMENT ON COLUMN "app"."change_plan_event"."created_at" IS '创建时间';
COMMENT ON COLUMN "app"."change_plan_event"."updated_at" IS '更新时间';
COMMENT ON COLUMN "app"."change_plan_event"."plan_id" IS '所属变更计划';
COMMENT ON COLUMN "app"."change_plan_event"."execution_id" IS '关联执行尝试';
COMMENT ON COLUMN "app"."change_plan_event"."event_type" IS '事件类型';
COMMENT ON COLUMN "app"."change_plan_event"."actor_user_id" IS '操作者';
COMMENT ON COLUMN "app"."change_plan_event"."summary" IS '事件摘要';
COMMENT ON COLUMN "app"."change_plan_event"."payload" IS '事件负载（不含凭据与补丁正文）';
