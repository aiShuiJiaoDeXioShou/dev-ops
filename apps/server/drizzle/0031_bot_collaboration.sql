CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE TABLE "app"."bot" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" varchar(60) NOT NULL,
	"avatar_key" text,
	"responsibility" text NOT NULL,
	"instructions" text DEFAULT '' NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"model_connection_id" uuid,
	"model_id" text,
	"status" text DEFAULT 'enabled' NOT NULL,
	"config_version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid NOT NULL,
	CONSTRAINT "pk_bot_id" PRIMARY KEY("id"),
	CONSTRAINT "uk_bot_team_name" UNIQUE("team_id","name"),
	CONSTRAINT "ck_bot_status" CHECK ("app"."bot"."status" in ('enabled', 'disabled')),
	CONSTRAINT "ck_bot_model_pair" CHECK (("app"."bot"."model_connection_id" is null) = ("app"."bot"."model_id" is null)),
	CONSTRAINT "ck_bot_config_version" CHECK ("app"."bot"."config_version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "app"."bot_api_call" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"run_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"method" text,
	"target" text NOT NULL,
	"idempotency_key" text,
	"input_summary" text NOT NULL,
	"status" text NOT NULL,
	"result_code" text,
	"result_ref" jsonb,
	CONSTRAINT "pk_bot_api_call_id" PRIMARY KEY("id"),
	CONSTRAINT "uk_bot_api_call_idem" UNIQUE("run_id","idempotency_key"),
	CONSTRAINT "ck_bot_api_call_kind" CHECK ("app"."bot_api_call"."kind" in ('platform_api', 'web_search', 'web_fetch', 'memory', 'task_result')),
	CONSTRAINT "ck_bot_api_call_status" CHECK ("app"."bot_api_call"."status" in ('succeeded', 'failed', 'rejected', 'unknown')),
	CONSTRAINT "ck_bot_api_call_method" CHECK (
    ("app"."bot_api_call"."kind" = 'platform_api' and "app"."bot_api_call"."method" is not null and "app"."bot_api_call"."method" in ('GET', 'POST'))
    or ("app"."bot_api_call"."kind" <> 'platform_api' and "app"."bot_api_call"."method" is null)
  )
);
--> statement-breakpoint
CREATE TABLE "app"."bot_conversation" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"name" varchar(80) NOT NULL,
	"leader_bot_id" uuid,
	"responsibility" text DEFAULT '' NOT NULL,
	"instructions" text DEFAULT '' NOT NULL,
	"last_message_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	CONSTRAINT "pk_bot_conversation_id" PRIMARY KEY("id"),
	CONSTRAINT "ck_bot_conversation_leader" CHECK (
    ("app"."bot_conversation"."kind" = 'direct' and "app"."bot_conversation"."leader_bot_id" is null) or ("app"."bot_conversation"."kind" = 'group' and "app"."bot_conversation"."leader_bot_id" is not null)
  )
);
--> statement-breakpoint
CREATE TABLE "app"."bot_conversation_member" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"member_kind" text NOT NULL,
	"member_id" uuid NOT NULL,
	"added_by" uuid NOT NULL,
	"removed_at" timestamp with time zone,
	CONSTRAINT "pk_bot_conversation_member_id" PRIMARY KEY("id"),
	CONSTRAINT "ck_bot_conversation_member_kind" CHECK ("app"."bot_conversation_member"."member_kind" in ('user', 'bot'))
);
--> statement-breakpoint
CREATE TABLE "app"."bot_event" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"sequence" bigint NOT NULL,
	"run_id" uuid NOT NULL,
	"run_sequence" integer,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	CONSTRAINT "pk_bot_event_id" PRIMARY KEY("id"),
	CONSTRAINT "uk_bot_event_sequence" UNIQUE("conversation_id","sequence"),
	CONSTRAINT "uk_bot_event_run_sequence" UNIQUE("run_id","run_sequence"),
	CONSTRAINT "ck_bot_event_sequence" CHECK ("app"."bot_event"."sequence" > 0 and ("app"."bot_event"."run_sequence" is null or "app"."bot_event"."run_sequence" > 0)),
	CONSTRAINT "ck_bot_event_kind" CHECK ("app"."bot_event"."kind" in ('run_status', 'output_delta', 'tool_activity', 'message_committed'))
);
--> statement-breakpoint
CREATE TABLE "app"."bot_login_session" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"connection_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"prompt" jsonb,
	"answer_secret" text,
	"expires_at" timestamp with time zone NOT NULL,
	"lease_owner" text,
	"lease_until" timestamp with time zone,
	CONSTRAINT "pk_bot_login_session_id" PRIMARY KEY("id"),
	CONSTRAINT "ck_bot_login_session_status" CHECK ("app"."bot_login_session"."status" in ('pending', 'waiting_user', 'succeeded', 'failed', 'expired'))
);
--> statement-breakpoint
CREATE TABLE "app"."bot_memory" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"bot_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"user_id" uuid,
	"content" varchar(2000) NOT NULL,
	"normalized_content" text NOT NULL,
	"essential" boolean DEFAULT false NOT NULL,
	"source_conversation_id" uuid,
	"source_user_id" uuid NOT NULL,
	"updated_by_kind" text NOT NULL,
	CONSTRAINT "pk_bot_memory_id" PRIMARY KEY("id"),
	CONSTRAINT "ck_bot_memory_scope" CHECK (
    ("app"."bot_memory"."scope" = 'user' and "app"."bot_memory"."user_id" is not null) or ("app"."bot_memory"."scope" = 'bot' and "app"."bot_memory"."user_id" is null)
  ),
	CONSTRAINT "ck_bot_memory_updater" CHECK ("app"."bot_memory"."updated_by_kind" in ('bot', 'user'))
);
--> statement-breakpoint
CREATE TABLE "app"."bot_message" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"sequence" bigint NOT NULL,
	"speaker_kind" text NOT NULL,
	"speaker_id" uuid,
	"body" jsonb NOT NULL,
	"run_id" uuid,
	"client_request_id" uuid,
	CONSTRAINT "pk_bot_message_id" PRIMARY KEY("id"),
	CONSTRAINT "uk_bot_message_sequence" UNIQUE("conversation_id","sequence"),
	CONSTRAINT "uk_bot_message_client_request" UNIQUE("conversation_id","client_request_id"),
	CONSTRAINT "ck_bot_message_sequence" CHECK ("app"."bot_message"."sequence" > 0),
	CONSTRAINT "ck_bot_message_speaker" CHECK (
    ("app"."bot_message"."speaker_kind" in ('user', 'bot') and "app"."bot_message"."speaker_id" is not null)
    or ("app"."bot_message"."speaker_kind" = 'system' and "app"."bot_message"."speaker_id" is null)
  )
);
--> statement-breakpoint
CREATE TABLE "app"."bot_model_catalog" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid DEFAULT '00000000-0000-0000-0000-000000000000' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"provider_id" text NOT NULL,
	"model_id" text NOT NULL,
	"display_name" text NOT NULL,
	"auth_types" text[] NOT NULL,
	"context_window" integer,
	"reported_at" timestamp with time zone NOT NULL,
	CONSTRAINT "pk_bot_model_catalog_id" PRIMARY KEY("id"),
	CONSTRAINT "uk_bot_model_catalog" UNIQUE("provider_id","model_id"),
	CONSTRAINT "ck_bot_model_catalog_global" CHECK ("app"."bot_model_catalog"."team_id" = '00000000-0000-0000-0000-000000000000'::uuid),
	CONSTRAINT "ck_bot_model_catalog_context" CHECK ("app"."bot_model_catalog"."context_window" > 0),
	CONSTRAINT "ck_bot_model_catalog_auth_types" CHECK ("app"."bot_model_catalog"."auth_types" <@ array['api_key', 'oauth']::text[])
);
--> statement-breakpoint
CREATE TABLE "app"."bot_model_connection" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" varchar(60) NOT NULL,
	"provider_id" text NOT NULL,
	"auth_type" text NOT NULL,
	"credential_id" uuid,
	"oauth_secret" text,
	"login_user_id" uuid,
	"status" text NOT NULL,
	"disabled_reason" text,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "pk_bot_model_connection_id" PRIMARY KEY("id"),
	CONSTRAINT "uk_bot_model_connection_team_name" UNIQUE("team_id","name"),
	CONSTRAINT "ck_bot_model_connection_auth" CHECK (
    ("app"."bot_model_connection"."auth_type" = 'api_key' and "app"."bot_model_connection"."credential_id" is not null
      and "app"."bot_model_connection"."oauth_secret" is null and "app"."bot_model_connection"."login_user_id" is null)
    or ("app"."bot_model_connection"."auth_type" = 'oauth' and "app"."bot_model_connection"."login_user_id" is not null and "app"."bot_model_connection"."credential_id" is null)
  ),
	CONSTRAINT "ck_bot_model_connection_status" CHECK ("app"."bot_model_connection"."status" in ('active', 'disabled', 'login_failed')),
	CONSTRAINT "ck_bot_model_connection_reason" CHECK ("app"."bot_model_connection"."disabled_reason" in ('manual', 'login_user_demoted', 'auth_expired')),
	CONSTRAINT "ck_bot_model_connection_version" CHECK ("app"."bot_model_connection"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "app"."bot_run" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"task_id" uuid,
	"bot_id" uuid NOT NULL,
	"trigger_user_id" uuid NOT NULL,
	"trigger_message_id" uuid,
	"input_version" integer NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"failure_kind" text,
	"failure_message" text,
	"config_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"lease_owner" text,
	"lease_until" timestamp with time zone,
	"lease_epoch" integer DEFAULT 0 NOT NULL,
	"stop_requested" boolean DEFAULT false NOT NULL,
	"turns" integer DEFAULT 0 NOT NULL,
	"usage" jsonb,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	CONSTRAINT "pk_bot_run_id" PRIMARY KEY("id"),
	CONSTRAINT "ck_bot_run_status" CHECK ("app"."bot_run"."status" in ('queued', 'running', 'succeeded', 'failed', 'stopped')),
	CONSTRAINT "ck_bot_run_failure" CHECK (
    ("app"."bot_run"."status" = 'failed') = ("app"."bot_run"."failure_kind" is not null)
    and ("app"."bot_run"."failure_kind" is null or "app"."bot_run"."failure_kind" in
      ('model_error', 'model_quota', 'timeout', 'turn_limit', 'execution_interrupted', 'model_unavailable', 'tool_error'))
  ),
	CONSTRAINT "ck_bot_run_counters" CHECK ("app"."bot_run"."input_version" >= 0 and "app"."bot_run"."lease_epoch" >= 0 and "app"."bot_run"."turns" >= 0)
);
--> statement-breakpoint
CREATE TABLE "app"."bot_skill" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"bot_id" uuid NOT NULL,
	"skill_id" uuid NOT NULL,
	"configured_by" uuid NOT NULL,
	CONSTRAINT "pk_bot_skill_id" PRIMARY KEY("id"),
	CONSTRAINT "uk_bot_skill" UNIQUE("bot_id","skill_id")
);
--> statement-breakpoint
CREATE TABLE "app"."bot_task" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"title" varchar(200) NOT NULL,
	"acceptance_criteria" text NOT NULL,
	"business_owner_id" uuid NOT NULL,
	"executor_bot_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"wait_reason" text,
	"blocked" boolean DEFAULT false NOT NULL,
	"input_version" integer DEFAULT 1 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"tagged_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	CONSTRAINT "pk_bot_task_id" PRIMARY KEY("id"),
	CONSTRAINT "ck_bot_task_status" CHECK ("app"."bot_task"."status" in ('pending', 'in_progress', 'waiting', 'awaiting_review', 'completed', 'cancelled')),
	CONSTRAINT "ck_bot_task_wait_reason" CHECK (
    ("app"."bot_task"."status" = 'waiting') = ("app"."bot_task"."wait_reason" is not null)
    and ("app"."bot_task"."wait_reason" is null or "app"."bot_task"."wait_reason" in ('needs_input', 'run_failed', 'executor_unavailable', 'stopped'))
  ),
	CONSTRAINT "ck_bot_task_version" CHECK ("app"."bot_task"."version" >= 1 and "app"."bot_task"."input_version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "app"."bot_task_handoff" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"task_id" uuid NOT NULL,
	"from_bot_id" uuid NOT NULL,
	"to_bot_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"summary" text NOT NULL,
	"unfinished" text NOT NULL,
	"created_by" uuid NOT NULL,
	CONSTRAINT "pk_bot_task_handoff_id" PRIMARY KEY("id"),
	CONSTRAINT "ck_bot_task_handoff_executor" CHECK ("app"."bot_task_handoff"."from_bot_id" <> "app"."bot_task_handoff"."to_bot_id")
);
--> statement-breakpoint
CREATE TABLE "app"."bot_task_input" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"task_id" uuid NOT NULL,
	"input_version" integer NOT NULL,
	"content" text NOT NULL,
	"created_by" uuid NOT NULL,
	CONSTRAINT "pk_bot_task_input_id" PRIMARY KEY("id"),
	CONSTRAINT "uk_bot_task_input_version" UNIQUE("task_id","input_version"),
	CONSTRAINT "ck_bot_task_input_version" CHECK ("app"."bot_task_input"."input_version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "app"."bot_task_result" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"task_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"body" text NOT NULL,
	"completion_note" text NOT NULL,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"submitted_by_bot_id" uuid NOT NULL,
	CONSTRAINT "pk_bot_task_result_id" PRIMARY KEY("id"),
	CONSTRAINT "uk_bot_task_result_run" UNIQUE("run_id")
);
--> statement-breakpoint
CREATE TABLE "app"."bot_task_review" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"task_id" uuid NOT NULL,
	"result_id" uuid NOT NULL,
	"decision" text NOT NULL,
	"comment" text,
	"reviewer_user_id" uuid NOT NULL,
	CONSTRAINT "pk_bot_task_review_id" PRIMARY KEY("id"),
	CONSTRAINT "uk_bot_task_review_result" UNIQUE("result_id"),
	CONSTRAINT "ck_bot_task_review_decision" CHECK ("app"."bot_task_review"."decision" in ('accepted', 'changes_requested'))
);
--> statement-breakpoint
CREATE TABLE "app"."work_tag" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" varchar(40) NOT NULL,
	"normalized_name" text NOT NULL,
	CONSTRAINT "pk_work_tag_id" PRIMARY KEY("id"),
	CONSTRAINT "uk_work_tag_team_name" UNIQUE("team_id","normalized_name")
);
--> statement-breakpoint
CREATE TABLE "app"."work_tag_link" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"tag_id" uuid NOT NULL,
	"target_kind" text NOT NULL,
	"target_id" uuid NOT NULL,
	"linked_by_kind" text NOT NULL,
	"linked_by_id" uuid NOT NULL,
	CONSTRAINT "pk_work_tag_link_id" PRIMARY KEY("id"),
	CONSTRAINT "uk_work_tag_link" UNIQUE("tag_id","target_kind","target_id"),
	CONSTRAINT "ck_work_tag_link_target" CHECK ("app"."work_tag_link"."target_kind" in ('conversation', 'task')),
	CONSTRAINT "ck_work_tag_link_actor" CHECK ("app"."work_tag_link"."linked_by_kind" in ('user', 'bot'))
);
--> statement-breakpoint
ALTER TABLE "app"."activity" ADD COLUMN "via_bot_id" uuid;--> statement-breakpoint
CREATE INDEX "idx_bot_team_owner" ON "app"."bot" USING btree ("team_id","owner_user_id");--> statement-breakpoint
CREATE INDEX "idx_bot_conversation_team_last" ON "app"."bot_conversation" USING btree ("team_id","last_message_at" DESC NULLS LAST,"id");--> statement-breakpoint
CREATE UNIQUE INDEX "uk_bot_conversation_member_active" ON "app"."bot_conversation_member" USING btree ("conversation_id","member_kind","member_id") WHERE "app"."bot_conversation_member"."removed_at" is null;--> statement-breakpoint
CREATE INDEX "idx_bot_conversation_member_access" ON "app"."bot_conversation_member" USING btree ("team_id","member_kind","member_id","conversation_id") WHERE "app"."bot_conversation_member"."removed_at" is null;--> statement-breakpoint
CREATE INDEX "idx_bot_login_session_status_expires" ON "app"."bot_login_session" USING btree ("status","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uk_bot_memory_scope_content" ON "app"."bot_memory" USING btree ("bot_id","scope",coalesce("user_id", '00000000-0000-0000-0000-000000000000'::uuid),"normalized_content");--> statement-breakpoint
CREATE INDEX "idx_bot_memory_trgm" ON "app"."bot_memory" USING gin ("normalized_content" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "idx_bot_memory_bot_scope" ON "app"."bot_memory" USING btree ("bot_id","scope","user_id");--> statement-breakpoint
CREATE INDEX "idx_bot_model_connection_login_user" ON "app"."bot_model_connection" USING btree ("team_id","login_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uk_bot_run_conversation_running" ON "app"."bot_run" USING btree ("conversation_id") WHERE "app"."bot_run"."status" = 'running';--> statement-breakpoint
CREATE INDEX "idx_bot_run_queue" ON "app"."bot_run" USING btree ("status","created_at","id");--> statement-breakpoint
CREATE INDEX "idx_bot_run_team_status" ON "app"."bot_run" USING btree ("team_id","status");--> statement-breakpoint
CREATE INDEX "idx_bot_run_task" ON "app"."bot_run" USING btree ("task_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_bot_run_leased" ON "app"."bot_run" USING btree ("lease_until") WHERE "app"."bot_run"."status" = 'running';--> statement-breakpoint
CREATE INDEX "idx_bot_task_conversation" ON "app"."bot_task" USING btree ("conversation_id","created_at","id");--> statement-breakpoint
CREATE INDEX "idx_bot_task_team_executor" ON "app"."bot_task" USING btree ("team_id","executor_bot_id","status");--> statement-breakpoint
CREATE INDEX "idx_bot_task_team_inbox" ON "app"."bot_task" USING btree ("team_id","updated_at" DESC NULLS LAST,"id") WHERE "app"."bot_task"."status" = 'awaiting_review' or "app"."bot_task"."blocked";--> statement-breakpoint
CREATE INDEX "idx_bot_task_handoff_task" ON "app"."bot_task_handoff" USING btree ("task_id","created_at","id");--> statement-breakpoint
CREATE INDEX "idx_bot_task_result_task" ON "app"."bot_task_result" USING btree ("task_id","created_at","id");--> statement-breakpoint
CREATE INDEX "idx_bot_task_review_task" ON "app"."bot_task_review" USING btree ("task_id","created_at","id");--> statement-breakpoint
CREATE INDEX "idx_work_tag_link_target" ON "app"."work_tag_link" USING btree ("team_id","target_kind","target_id");
--> statement-breakpoint
COMMENT ON COLUMN "app"."activity"."via_bot_id" IS '在触发人权限下发起该活动的 Bot，人工操作时为空';
--> statement-breakpoint
COMMENT ON TABLE "app"."bot" IS '独立 Bot 的团队配置';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot"."id" IS '稳定标识';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot"."team_id" IS '所属团队标识';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot"."created_at" IS '创建时间';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot"."updated_at" IS '更新时间';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot"."name" IS '团队内唯一名称';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot"."avatar_key" IS '头像对象键，空时使用默认头像';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot"."responsibility" IS '职责说明';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot"."instructions" IS '运行指令';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot"."owner_user_id" IS '当前负责人';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot"."model_connection_id" IS '绑定的模型连接';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot"."model_id" IS '绑定的模型标识';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot"."status" IS 'enabled 已启用，disabled 已停用';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot"."config_version" IS '配置乐观锁版本，从 1 开始';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot"."created_by" IS '创建成员标识';
--> statement-breakpoint
COMMENT ON TABLE "app"."bot_api_call" IS '工具调用的脱敏追溯记录';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_api_call"."id" IS '稳定标识';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_api_call"."team_id" IS '所属团队标识';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_api_call"."created_at" IS '创建时间';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_api_call"."updated_at" IS '更新时间';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_api_call"."run_id" IS '所属运行';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_api_call"."kind" IS 'platform_api 平台接口，web_search 搜索，web_fetch 网页读取，memory 记忆，task_result 任务结果';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_api_call"."method" IS '平台接口的 GET 或 POST，其余为空';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_api_call"."target" IS '脱敏后的路径或网址';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_api_call"."idempotency_key" IS '对一次写入意图稳定的幂等键';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_api_call"."input_summary" IS '脱敏后的精简参数摘要';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_api_call"."status" IS 'succeeded 成功，failed 失败，rejected 拒绝，unknown 结果未知';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_api_call"."result_code" IS '业务错误码或 HTTP 状态';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_api_call"."result_ref" IS '相关资源类型和标识';
--> statement-breakpoint
COMMENT ON TABLE "app"."bot_conversation" IS '独立的 Bot 私聊与团队群组';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_conversation"."id" IS '稳定标识';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_conversation"."team_id" IS '所属团队标识';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_conversation"."created_at" IS '创建时间';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_conversation"."updated_at" IS '更新时间';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_conversation"."kind" IS 'direct 私聊，group 群组';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_conversation"."name" IS '显示名称';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_conversation"."leader_bot_id" IS '群组默认应答 Bot，私聊为空';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_conversation"."responsibility" IS '会话职责';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_conversation"."instructions" IS '会话特定指令';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_conversation"."last_message_at" IS '最近一条已提交消息时间';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_conversation"."created_by" IS '创建成员';
--> statement-breakpoint
COMMENT ON TABLE "app"."bot_conversation_member" IS '会话成员历史和当前成员关系';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_conversation_member"."id" IS '稳定标识';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_conversation_member"."team_id" IS '所属团队标识';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_conversation_member"."created_at" IS '创建时间';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_conversation_member"."updated_at" IS '更新时间';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_conversation_member"."conversation_id" IS '所属会话';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_conversation_member"."member_kind" IS 'user 人类成员，bot Bot 成员';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_conversation_member"."member_id" IS '团队用户或 Bot 的标识';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_conversation_member"."added_by" IS '邀请关系的创建者';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_conversation_member"."removed_at" IS '移出时间，空表示仍为成员';
--> statement-breakpoint
COMMENT ON TABLE "app"."bot_event" IS '可按游标读取的会话增量事件';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_event"."id" IS '稳定标识';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_event"."team_id" IS '所属团队标识';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_event"."created_at" IS '创建时间';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_event"."updated_at" IS '更新时间';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_event"."conversation_id" IS '所属会话';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_event"."sequence" IS '会话各运行共享的递增序号';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_event"."run_id" IS '所属运行';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_event"."run_sequence" IS '库内事件序号，系统产生的事件为空';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_event"."kind" IS 'run_status 运行状态，output_delta 正文增量，tool_activity 工具活动，message_committed 正文入库';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_event"."payload" IS '经脱敏的增量内容或状态详情';
--> statement-breakpoint
COMMENT ON TABLE "app"."bot_login_session" IS '短期订阅登录交互';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_login_session"."id" IS '稳定标识';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_login_session"."team_id" IS '所属团队标识';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_login_session"."created_at" IS '创建时间';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_login_session"."updated_at" IS '更新时间';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_login_session"."connection_id" IS '目标模型连接';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_login_session"."status" IS 'pending 等待执行，waiting_user 等待用户，succeeded 成功，failed 失败，expired 过期';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_login_session"."prompt" IS '对发起者可见的授权链接、设备码或提示';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_login_session"."answer_secret" IS '回调码加密封装，消费后清空';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_login_session"."expires_at" IS '交互到期时间';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_login_session"."lease_owner" IS '领取授权交互的进程';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_login_session"."lease_until" IS '领取租约到期时间';
--> statement-breakpoint
COMMENT ON TABLE "app"."bot_memory" IS 'Bot 笔记及按成员隔离的用户画像';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_memory"."id" IS '稳定标识';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_memory"."team_id" IS '所属团队标识';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_memory"."created_at" IS '创建时间';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_memory"."updated_at" IS '更新时间';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_memory"."bot_id" IS '记忆所归属的 Bot';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_memory"."scope" IS 'user 用户画像，bot Bot 笔记';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_memory"."user_id" IS '用户画像所属成员，Bot 笔记为空';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_memory"."content" IS '记忆正文，最多 2000 字符';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_memory"."normalized_content" IS 'Unicode、空白和大小写规范化后的正文';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_memory"."essential" IS '是否随运行常驻注入';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_memory"."source_conversation_id" IS '生成记忆的会话，手工新增为空';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_memory"."source_user_id" IS '记忆来源成员';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_memory"."updated_by_kind" IS 'bot 自动记录，user 手工维护';
--> statement-breakpoint
COMMENT ON TABLE "app"."bot_message" IS '已经提交的会话消息';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_message"."id" IS '稳定标识';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_message"."team_id" IS '所属团队标识';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_message"."created_at" IS '创建时间';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_message"."updated_at" IS '更新时间';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_message"."conversation_id" IS '所属会话';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_message"."sequence" IS '会话内递增序号';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_message"."speaker_kind" IS 'user 人类，bot Bot，system 系统';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_message"."speaker_id" IS '用户或 Bot 标识，系统消息为空';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_message"."body" IS '平台中立消息块';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_message"."run_id" IS '产生消息的运行';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_message"."client_request_id" IS '客户端发送重试去重标识';
--> statement-breakpoint
COMMENT ON TABLE "app"."bot_model_catalog" IS '执行进程报告的全局模型目录';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_model_catalog"."id" IS '稳定标识';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_model_catalog"."team_id" IS '全局目录固定使用零值 UUID';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_model_catalog"."created_at" IS '创建时间';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_model_catalog"."updated_at" IS '更新时间';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_model_catalog"."provider_id" IS '模型提供方标识';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_model_catalog"."model_id" IS '提供方内的模型标识';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_model_catalog"."display_name" IS '模型名称';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_model_catalog"."auth_types" IS '可用授权方式，api_key 或 oauth';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_model_catalog"."context_window" IS '上下文窗口大小，单位为 token';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_model_catalog"."reported_at" IS '执行进程的最近上报时间';
--> statement-breakpoint
COMMENT ON TABLE "app"."bot_model_connection" IS 'Bot 连接模型的授权配置';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_model_connection"."id" IS '稳定标识';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_model_connection"."team_id" IS '所属团队标识';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_model_connection"."created_at" IS '创建时间';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_model_connection"."updated_at" IS '更新时间';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_model_connection"."name" IS '团队内连接名称';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_model_connection"."provider_id" IS '模型提供方标识';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_model_connection"."auth_type" IS 'api_key 密钥，oauth 订阅';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_model_connection"."credential_id" IS '密钥模式引用的团队凭据';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_model_connection"."oauth_secret" IS '订阅令牌的加密封装';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_model_connection"."login_user_id" IS '订阅授权的成员';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_model_connection"."status" IS 'active 可用，disabled 已停用，login_failed 登录失败';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_model_connection"."disabled_reason" IS 'manual 手动，login_user_demoted 登录人成员资格变化，auth_expired 授权失效';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_model_connection"."version" IS '连接凭据的乐观锁版本';
--> statement-breakpoint
COMMENT ON TABLE "app"."bot_run" IS 'Bot 执行队列、租约和结果摘要';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_run"."id" IS '稳定标识';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_run"."team_id" IS '所属团队标识';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_run"."created_at" IS '创建时间';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_run"."updated_at" IS '更新时间';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_run"."conversation_id" IS '所属会话';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_run"."task_id" IS '关联任务，普通回复为空';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_run"."bot_id" IS '执行 Bot';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_run"."trigger_user_id" IS '本次运行的触发人';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_run"."trigger_message_id" IS '触发会话消息，任务可为空';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_run"."input_version" IS '任务输入版本，普通回复为 0';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_run"."status" IS 'queued 排队，running 执行，succeeded 成功，failed 失败，stopped 停止';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_run"."failure_kind" IS '模型错误或额度、超时、轮次、执行中断、模型不可用或工具失败';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_run"."failure_message" IS '脱敏的面向用户失败说明';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_run"."config_snapshot" IS '领取时固定的运行配置和技能版本';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_run"."lease_owner" IS '领取运行的执行进程';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_run"."lease_until" IS '当前代次的租约到期时间';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_run"."lease_epoch" IS '领取代次，从 0 开始递增';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_run"."stop_requested" IS '当前运行是否收到停止请求';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_run"."turns" IS '模型推理使用的轮次';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_run"."usage" IS '模型输入、输出和缓存用量及美元成本';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_run"."started_at" IS '领取并开始运行时间';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_run"."finished_at" IS '进入终态时间';
--> statement-breakpoint
COMMENT ON TABLE "app"."bot_skill" IS 'Bot 与技能的配置关系';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_skill"."id" IS '稳定标识';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_skill"."team_id" IS '所属团队标识';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_skill"."created_at" IS '创建时间';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_skill"."updated_at" IS '更新时间';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_skill"."bot_id" IS '配置所归属的 Bot';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_skill"."skill_id" IS '引用的团队技能';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_skill"."configured_by" IS '配置关系的成员';
--> statement-breakpoint
COMMENT ON TABLE "app"."bot_task" IS '会话中的显式协作任务';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_task"."id" IS '稳定标识';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_task"."team_id" IS '所属团队标识';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_task"."created_at" IS '创建时间';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_task"."updated_at" IS '更新时间';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_task"."conversation_id" IS '所属会话';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_task"."title" IS '任务标题或目标';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_task"."acceptance_criteria" IS '人工验收条件';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_task"."business_owner_id" IS '业务负责人';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_task"."executor_bot_id" IS '当前执行者';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_task"."status" IS 'pending 待执行，in_progress 执行中，waiting 等待，awaiting_review 待验收，completed 完成，cancelled 取消';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_task"."wait_reason" IS 'needs_input 缺少输入，run_failed 运行失败，executor_unavailable 执行者不可用，stopped 已停止';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_task"."blocked" IS '任务是否因执行者或模型不可用而受阻';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_task"."input_version" IS '当前输入版本';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_task"."version" IS '任务操作的乐观锁版本';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_task"."tagged_at" IS '首次自动整理标签的时间';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_task"."created_by" IS '任务创建人';
--> statement-breakpoint
COMMENT ON TABLE "app"."bot_task_handoff" IS '人工追加的任务转交记录';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_task_handoff"."id" IS '稳定标识';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_task_handoff"."team_id" IS '所属团队标识';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_task_handoff"."created_at" IS '创建时间';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_task_handoff"."updated_at" IS '更新时间';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_task_handoff"."task_id" IS '所属任务';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_task_handoff"."from_bot_id" IS '原执行者';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_task_handoff"."to_bot_id" IS '新执行者';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_task_handoff"."reason" IS '转交原因';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_task_handoff"."summary" IS '原执行者的工作摘要';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_task_handoff"."unfinished" IS '需要接手的未完成事项';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_task_handoff"."created_by" IS '发起转交的成员';
--> statement-breakpoint
COMMENT ON TABLE "app"."bot_task_input" IS '按版本追加的任务要求';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_task_input"."id" IS '稳定标识';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_task_input"."team_id" IS '所属团队标识';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_task_input"."created_at" IS '创建时间';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_task_input"."updated_at" IS '更新时间';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_task_input"."task_id" IS '所属任务';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_task_input"."input_version" IS '要求版本，从 1 开始';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_task_input"."content" IS '初始或补充要求正文';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_task_input"."created_by" IS '提交要求的成员';
--> statement-breakpoint
COMMENT ON TABLE "app"."bot_task_result" IS 'Bot 提交的任务验收结果';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_task_result"."id" IS '稳定标识';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_task_result"."team_id" IS '所属团队标识';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_task_result"."created_at" IS '创建时间';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_task_result"."updated_at" IS '更新时间';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_task_result"."task_id" IS '所属任务';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_task_result"."run_id" IS '提交结果的运行';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_task_result"."body" IS '结果正文';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_task_result"."completion_note" IS '完成情况说明';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_task_result"."evidence" IS '支持验收的引用列表';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_task_result"."submitted_by_bot_id" IS '提交结果的 Bot';
--> statement-breakpoint
COMMENT ON TABLE "app"."bot_task_review" IS '任务结果的单次人工评审';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_task_review"."id" IS '稳定标识';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_task_review"."team_id" IS '所属团队标识';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_task_review"."created_at" IS '创建时间';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_task_review"."updated_at" IS '更新时间';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_task_review"."task_id" IS '所属任务';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_task_review"."result_id" IS '本次评审的结果';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_task_review"."decision" IS 'accepted 通过，changes_requested 退回';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_task_review"."comment" IS '评审备注或退回原因';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_task_review"."reviewer_user_id" IS '人工评审成员';
--> statement-breakpoint
COMMENT ON TABLE "app"."work_tag" IS '用于组织协作工作的团队标签';
--> statement-breakpoint
COMMENT ON COLUMN "app"."work_tag"."id" IS '稳定标识';
--> statement-breakpoint
COMMENT ON COLUMN "app"."work_tag"."team_id" IS '所属团队标识';
--> statement-breakpoint
COMMENT ON COLUMN "app"."work_tag"."created_at" IS '创建时间';
--> statement-breakpoint
COMMENT ON COLUMN "app"."work_tag"."updated_at" IS '更新时间';
--> statement-breakpoint
COMMENT ON COLUMN "app"."work_tag"."name" IS '标签展示名';
--> statement-breakpoint
COMMENT ON COLUMN "app"."work_tag"."normalized_name" IS '用于团队内去重的标准名称';
--> statement-breakpoint
COMMENT ON TABLE "app"."work_tag_link" IS '标签与会话或任务的关联';
--> statement-breakpoint
COMMENT ON COLUMN "app"."work_tag_link"."id" IS '稳定标识';
--> statement-breakpoint
COMMENT ON COLUMN "app"."work_tag_link"."team_id" IS '所属团队标识';
--> statement-breakpoint
COMMENT ON COLUMN "app"."work_tag_link"."created_at" IS '创建时间';
--> statement-breakpoint
COMMENT ON COLUMN "app"."work_tag_link"."updated_at" IS '更新时间';
--> statement-breakpoint
COMMENT ON COLUMN "app"."work_tag_link"."tag_id" IS '团队标签标识';
--> statement-breakpoint
COMMENT ON COLUMN "app"."work_tag_link"."target_kind" IS 'conversation 会话，task 任务';
--> statement-breakpoint
COMMENT ON COLUMN "app"."work_tag_link"."target_id" IS '被分类对象的标识';
--> statement-breakpoint
COMMENT ON COLUMN "app"."work_tag_link"."linked_by_kind" IS 'user 人类，bot Bot';
--> statement-breakpoint
COMMENT ON COLUMN "app"."work_tag_link"."linked_by_id" IS '建立关系的人或 Bot';
