CREATE TABLE "app"."bot_conversation_bot_setting" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"bot_id" uuid NOT NULL,
	"model_id" text,
	"thinking_level" text,
	"updated_by" uuid NOT NULL,
	CONSTRAINT "pk_bot_conversation_bot_setting_id" PRIMARY KEY("id"),
	CONSTRAINT "uk_bot_conversation_bot_setting" UNIQUE("conversation_id","bot_id"),
	CONSTRAINT "ck_bot_conversation_bot_thinking" CHECK ("app"."bot_conversation_bot_setting"."thinking_level" in ('off', 'minimal', 'low', 'medium', 'high', 'xhigh'))
);
--> statement-breakpoint
CREATE TABLE "app"."bot_mcp_server" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" varchar(40) NOT NULL,
	"url" text NOT NULL,
	"credential_id" uuid,
	"exposure" text NOT NULL,
	"status" text DEFAULT 'enabled' NOT NULL,
	"bot_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	CONSTRAINT "pk_bot_mcp_server_id" PRIMARY KEY("id"),
	CONSTRAINT "uk_bot_mcp_server_team_name" UNIQUE("team_id","name"),
	CONSTRAINT "ck_bot_mcp_server_exposure" CHECK ("app"."bot_mcp_server"."exposure" in ('direct', 'deferred')),
	CONSTRAINT "ck_bot_mcp_server_status" CHECK ("app"."bot_mcp_server"."status" in ('enabled', 'disabled')),
	CONSTRAINT "ck_bot_mcp_server_bot_ids" CHECK (jsonb_typeof("app"."bot_mcp_server"."bot_ids") = 'array')
);
--> statement-breakpoint
CREATE TABLE "app"."bot_memory_cursor" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"bot_id" uuid NOT NULL,
	"processed_until" timestamp with time zone NOT NULL,
	"last_run_id" uuid,
	"last_result" text,
	CONSTRAINT "pk_bot_memory_cursor_id" PRIMARY KEY("id"),
	CONSTRAINT "uk_bot_memory_cursor_bot" UNIQUE("bot_id"),
	CONSTRAINT "ck_bot_memory_cursor_result" CHECK ("app"."bot_memory_cursor"."last_result" in ('applied', 'no_change', 'skipped_budget', 'skipped_model', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "app"."bot_prompt_template" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" varchar(40) NOT NULL,
	"description" varchar(200) NOT NULL,
	"body" text NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	CONSTRAINT "pk_bot_prompt_template_id" PRIMARY KEY("id"),
	CONSTRAINT "uk_bot_prompt_template_team_name" UNIQUE("team_id","name"),
	CONSTRAINT "ck_bot_prompt_template_name" CHECK ("app"."bot_prompt_template"."name" ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);
--> statement-breakpoint
CREATE TABLE "app"."bot_room_relay" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"origin_message_id" uuid NOT NULL,
	"trigger_user_id" uuid NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"end_reason" text,
	"hop_count" integer DEFAULT 0 NOT NULL,
	"reply_count" integer DEFAULT 0 NOT NULL,
	"continue_count" integer DEFAULT 0 NOT NULL,
	"pending_bot_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "pk_bot_room_relay_id" PRIMARY KEY("id"),
	CONSTRAINT "ck_bot_room_relay_status" CHECK ("app"."bot_room_relay"."status" in ('running', 'paused', 'finished', 'stopped')),
	CONSTRAINT "ck_bot_room_relay_counts" CHECK ("app"."bot_room_relay"."hop_count" >= 0 and "app"."bot_room_relay"."reply_count" >= 0 and "app"."bot_room_relay"."continue_count" >= 0 and "app"."bot_room_relay"."version" > 0),
	CONSTRAINT "ck_bot_room_relay_pending" CHECK (jsonb_typeof("app"."bot_room_relay"."pending_bot_ids") = 'array'),
	CONSTRAINT "ck_bot_room_relay_reason" CHECK (("app"."bot_room_relay"."status" in ('finished', 'stopped')) = ("app"."bot_room_relay"."end_reason" is not null) and ("app"."bot_room_relay"."end_reason" is null or "app"."bot_room_relay"."end_reason" in ('completed', 'limit', 'stopped_by_member', 'budget_exhausted', 'ended_by_member')))
);
--> statement-breakpoint
CREATE TABLE "app"."bot_run_input" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"run_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"delivery_mode" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	CONSTRAINT "pk_bot_run_input_id" PRIMARY KEY("id"),
	CONSTRAINT "uk_bot_run_input_message" UNIQUE("message_id"),
	CONSTRAINT "ck_bot_run_input_mode" CHECK ("app"."bot_run_input"."delivery_mode" in ('steer', 'follow_up')),
	CONSTRAINT "ck_bot_run_input_status" CHECK ("app"."bot_run_input"."status" in ('pending', 'delivered', 'requeued'))
);
--> statement-breakpoint
CREATE TABLE "app"."bot_session" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"bot_id" uuid NOT NULL,
	"format_version" integer DEFAULT 3 NOT NULL,
	"leaf_entry_id" text,
	"synced_message_sequence" bigint DEFAULT 0 NOT NULL,
	"seeded_at" timestamp with time zone,
	"status" text DEFAULT 'active' NOT NULL,
	CONSTRAINT "pk_bot_session_id" PRIMARY KEY("id"),
	CONSTRAINT "uk_bot_session_conversation_bot" UNIQUE("conversation_id","bot_id"),
	CONSTRAINT "ck_bot_session_status" CHECK ("app"."bot_session"."status" in ('active', 'detached', 'corrupted')),
	CONSTRAINT "ck_bot_session_sequence" CHECK ("app"."bot_session"."synced_message_sequence" >= 0)
);
--> statement-breakpoint
CREATE TABLE "app"."bot_session_entry" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"session_id" uuid NOT NULL,
	"entry_id" text NOT NULL,
	"parent_entry_id" text,
	"entry_type" text NOT NULL,
	"sequence" bigint NOT NULL,
	"content" jsonb NOT NULL,
	"source_message_id" uuid,
	"run_id" uuid,
	CONSTRAINT "pk_bot_session_entry_id" PRIMARY KEY("id"),
	CONSTRAINT "uk_bot_session_entry_session_entry" UNIQUE("session_id","entry_id"),
	CONSTRAINT "uk_bot_session_entry_session_sequence" UNIQUE("session_id","sequence"),
	CONSTRAINT "ck_bot_session_entry_sequence" CHECK ("app"."bot_session_entry"."sequence" > 0)
);
--> statement-breakpoint
CREATE TABLE "app"."bot_usage_daily" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"bot_id" uuid NOT NULL,
	"usage_date" date NOT NULL,
	"input_tokens" bigint DEFAULT 0 NOT NULL,
	"output_tokens" bigint DEFAULT 0 NOT NULL,
	"cache_read_tokens" bigint DEFAULT 0 NOT NULL,
	"cache_write_tokens" bigint DEFAULT 0 NOT NULL,
	"cost_usd" numeric(14, 6) DEFAULT '0' NOT NULL,
	"unknown_cost_runs" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "pk_bot_usage_daily_id" PRIMARY KEY("id"),
	CONSTRAINT "uk_bot_usage_daily" UNIQUE("team_id","bot_id","usage_date"),
	CONSTRAINT "ck_bot_usage_daily_counts" CHECK ("app"."bot_usage_daily"."input_tokens" >= 0 and "app"."bot_usage_daily"."output_tokens" >= 0 and "app"."bot_usage_daily"."cache_read_tokens" >= 0 and "app"."bot_usage_daily"."cache_write_tokens" >= 0 and "app"."bot_usage_daily"."cost_usd" >= 0 and "app"."bot_usage_daily"."unknown_cost_runs" >= 0)
);
--> statement-breakpoint
CREATE TABLE "app"."team_bot_budget" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"monthly_limit_usd" numeric(12, 4),
	"updated_by" uuid NOT NULL,
	CONSTRAINT "pk_team_bot_budget_id" PRIMARY KEY("id"),
	CONSTRAINT "uk_team_bot_budget_team" UNIQUE("team_id"),
	CONSTRAINT "ck_team_bot_budget_positive" CHECK ("app"."team_bot_budget"."monthly_limit_usd" >= 0)
);
--> statement-breakpoint
CREATE TABLE "app"."team_bot_context" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"content" text NOT NULL,
	"updated_by" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "pk_team_bot_context_id" PRIMARY KEY("id"),
	CONSTRAINT "uk_team_bot_context_team" UNIQUE("team_id"),
	CONSTRAINT "ck_team_bot_context_length" CHECK (octet_length("app"."team_bot_context"."content") <= 16384),
	CONSTRAINT "ck_team_bot_context_version" CHECK ("app"."team_bot_context"."version" > 0)
);
--> statement-breakpoint
ALTER TABLE "app"."bot_event" DROP CONSTRAINT "ck_bot_event_kind";--> statement-breakpoint
ALTER TABLE "app"."bot_run" DROP CONSTRAINT "ck_bot_run_failure";--> statement-breakpoint
DROP INDEX "app"."uk_bot_run_conversation_running";--> statement-breakpoint
ALTER TABLE "app"."bot_run" ALTER COLUMN "conversation_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."bot_conversation" ADD COLUMN "forked_from_conversation_id" uuid;--> statement-breakpoint
ALTER TABLE "app"."bot_conversation" ADD COLUMN "forked_from_message_id" uuid;--> statement-breakpoint
ALTER TABLE "app"."bot_conversation" ADD COLUMN "active_branch_id" text;--> statement-breakpoint
ALTER TABLE "app"."bot_memory" ADD COLUMN "source_kind" text DEFAULT 'conversation' NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."bot_memory" ADD COLUMN "source_detail" jsonb;--> statement-breakpoint
ALTER TABLE "app"."bot_message" ADD COLUMN "branch_id" text;--> statement-breakpoint
ALTER TABLE "app"."bot_message" ADD COLUMN "edited_from_message_id" uuid;--> statement-breakpoint
ALTER TABLE "app"."bot_message" ADD COLUMN "relay_id" uuid;--> statement-breakpoint
ALTER TABLE "app"."bot_run" ADD COLUMN "kind" text DEFAULT 'reply' NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."bot_run" ADD COLUMN "relay_id" uuid;--> statement-breakpoint
ALTER TABLE "app"."bot_run" ADD COLUMN "relay_role" text;--> statement-breakpoint
ALTER TABLE "app"."bot_run" ADD COLUMN "hop" integer;--> statement-breakpoint
ALTER TABLE "app"."bot_run" ADD COLUMN "resume_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."bot_run" ADD COLUMN "is_skipped" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."bot_run" ADD COLUMN "relay_mentions" jsonb;--> statement-breakpoint
CREATE UNIQUE INDEX "uk_bot_room_relay_conversation_active" ON "app"."bot_room_relay" USING btree ("conversation_id") WHERE "app"."bot_room_relay"."status" in ('running', 'paused');--> statement-breakpoint
CREATE INDEX "idx_bot_run_input_pending" ON "app"."bot_run_input" USING btree ("run_id") WHERE "app"."bot_run_input"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "idx_bot_session_team" ON "app"."bot_session" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "idx_bot_session_entry_source" ON "app"."bot_session_entry" USING btree ("session_id","source_message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uk_bot_run_bot_consolidation_running" ON "app"."bot_run" USING btree ("bot_id") WHERE "app"."bot_run"."kind" = 'memory_consolidation' and "app"."bot_run"."status" = 'running';--> statement-breakpoint
CREATE INDEX "idx_bot_run_relay" ON "app"."bot_run" USING btree ("relay_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "uk_bot_run_conversation_running" ON "app"."bot_run" USING btree ("conversation_id") WHERE "app"."bot_run"."conversation_id" is not null and "app"."bot_run"."status" = 'running';--> statement-breakpoint
ALTER TABLE "app"."bot_event" ADD CONSTRAINT "ck_bot_event_kind" CHECK ("app"."bot_event"."kind" in ('run_status', 'output_delta', 'tool_activity', 'message_committed', 'compaction_started', 'compaction_finished', 'resumed', 'steer_delivered', 'follow_up_delivered', 'reply_skipped', 'mcp_call_started', 'mcp_call_finished', 'relay_paused', 'relay_finished'));--> statement-breakpoint
ALTER TABLE "app"."bot_memory" ADD CONSTRAINT "ck_bot_memory_source" CHECK ("app"."bot_memory"."source_kind" in ('conversation', 'consolidation'));--> statement-breakpoint
ALTER TABLE "app"."bot_run" ADD CONSTRAINT "ck_bot_run_kind" CHECK ("app"."bot_run"."kind" in ('reply', 'task', 'compact', 'memory_consolidation'));--> statement-breakpoint
ALTER TABLE "app"."bot_run" ADD CONSTRAINT "ck_bot_run_conversation" CHECK (("app"."bot_run"."kind" = 'memory_consolidation') = ("app"."bot_run"."conversation_id" is null));--> statement-breakpoint
ALTER TABLE "app"."bot_run" ADD CONSTRAINT "ck_bot_run_resume_count" CHECK ("app"."bot_run"."resume_count" between 0 and 2);--> statement-breakpoint
ALTER TABLE "app"."bot_run" ADD CONSTRAINT "ck_bot_run_relay_role" CHECK ("app"."bot_run"."relay_role" in ('leader', 'mention', 'all', 'relay'));--> statement-breakpoint
ALTER TABLE "app"."bot_run" ADD CONSTRAINT "ck_bot_run_failure" CHECK (
    ("app"."bot_run"."status" = 'failed') = ("app"."bot_run"."failure_kind" is not null)
    and ("app"."bot_run"."failure_kind" is null or "app"."bot_run"."failure_kind" in
      ('model_error', 'model_quota', 'timeout', 'turn_limit', 'execution_interrupted', 'model_unavailable', 'tool_error',
       'budget_exhausted', 'session_unavailable', 'context_overflow'))
  );
--> statement-breakpoint
UPDATE app.bot_run SET kind = 'task' WHERE task_id IS NOT NULL AND kind = 'reply';
--> statement-breakpoint
COMMENT ON TABLE app.bot_conversation_bot_setting IS '会话内单个 Bot 的模型与思考等级覆盖';
--> statement-breakpoint
COMMENT ON COLUMN app.bot_conversation_bot_setting.id IS '记录唯一标识';
--> statement-breakpoint
COMMENT ON COLUMN app.bot_conversation_bot_setting.team_id IS '所属团队标识';
--> statement-breakpoint
COMMENT ON COLUMN app.bot_conversation_bot_setting.created_at IS '记录创建时间';
--> statement-breakpoint
COMMENT ON COLUMN app.bot_conversation_bot_setting.updated_at IS '记录最后更新时间';
--> statement-breakpoint
COMMENT ON COLUMN app.bot_conversation_bot_setting.conversation_id IS '所属房间标识';
--> statement-breakpoint
COMMENT ON COLUMN app.bot_conversation_bot_setting.bot_id IS '关联 Bot 标识';
--> statement-breakpoint
COMMENT ON COLUMN app.bot_conversation_bot_setting.model_id IS '覆盖模型标识，空值表示沿用 Bot 模型';
--> statement-breakpoint
COMMENT ON COLUMN app.bot_conversation_bot_setting.thinking_level IS '思考等级，空值表示沿用模型默认值；off、minimal、low、medium、high、xhigh';
--> statement-breakpoint
COMMENT ON COLUMN app.bot_conversation_bot_setting.updated_by IS '最近修改的成员标识';
--> statement-breakpoint
COMMENT ON TABLE app.bot_mcp_server IS '团队配置的远程 MCP 服务器';
--> statement-breakpoint
COMMENT ON COLUMN app.bot_mcp_server.id IS '记录唯一标识';
--> statement-breakpoint
COMMENT ON COLUMN app.bot_mcp_server.team_id IS '所属团队标识';
--> statement-breakpoint
COMMENT ON COLUMN app.bot_mcp_server.created_at IS '记录创建时间';
--> statement-breakpoint
COMMENT ON COLUMN app.bot_mcp_server.updated_at IS '记录最后更新时间';
--> statement-breakpoint
COMMENT ON COLUMN app.bot_mcp_server.name IS '团队内唯一服务器名称';
--> statement-breakpoint
COMMENT ON COLUMN app.bot_mcp_server.url IS '远程 MCP 服务地址';
--> statement-breakpoint
COMMENT ON COLUMN app.bot_mcp_server.credential_id IS '引用的团队凭据标识，空值表示无认证';
--> statement-breakpoint
COMMENT ON COLUMN app.bot_mcp_server.exposure IS 'direct 直接注册，deferred 通过工具搜索发现';
--> statement-breakpoint
COMMENT ON COLUMN app.bot_mcp_server.status IS 'enabled 启用，disabled 禁用';
--> statement-breakpoint
COMMENT ON COLUMN app.bot_mcp_server.bot_ids IS '按顺序保存已授予 Bot 标识的 JSON 数组';
--> statement-breakpoint
COMMENT ON COLUMN app.bot_mcp_server.created_by IS '创建记录的成员标识';
--> statement-breakpoint
COMMENT ON COLUMN app.bot_mcp_server.updated_by IS '最近修改的成员标识';
--> statement-breakpoint
COMMENT ON TABLE app.bot_memory_cursor IS '每个 Bot 的最近记忆整理结果及输入游标';
--> statement-breakpoint
COMMENT ON COLUMN app.bot_memory_cursor.id IS '记录唯一标识';
--> statement-breakpoint
COMMENT ON COLUMN app.bot_memory_cursor.team_id IS '所属团队标识';
--> statement-breakpoint
COMMENT ON COLUMN app.bot_memory_cursor.created_at IS '记录创建时间';
--> statement-breakpoint
COMMENT ON COLUMN app.bot_memory_cursor.updated_at IS '记录最后更新时间';
--> statement-breakpoint
COMMENT ON COLUMN app.bot_memory_cursor.bot_id IS '关联 Bot 标识';
--> statement-breakpoint
COMMENT ON COLUMN app.bot_memory_cursor.processed_until IS '已纳入整理的数据截止时间';
--> statement-breakpoint
COMMENT ON COLUMN app.bot_memory_cursor.last_run_id IS '最近一次整理的运行标识';
--> statement-breakpoint
COMMENT ON COLUMN app.bot_memory_cursor.last_result IS 'applied 已写入，no_change 无变更，skipped_budget 预算跳过，skipped_model 模型跳过，failed 失败';
--> statement-breakpoint
COMMENT ON TABLE app.bot_prompt_template IS '团队可复用的 Bot 提示模板';
--> statement-breakpoint
COMMENT ON COLUMN app.bot_prompt_template.id IS '记录唯一标识';
--> statement-breakpoint
COMMENT ON COLUMN app.bot_prompt_template.team_id IS '所属团队标识';
--> statement-breakpoint
COMMENT ON COLUMN app.bot_prompt_template.created_at IS '记录创建时间';
--> statement-breakpoint
COMMENT ON COLUMN app.bot_prompt_template.updated_at IS '记录最后更新时间';
--> statement-breakpoint
COMMENT ON COLUMN app.bot_prompt_template.name IS '团队内唯一的模板命令名';
--> statement-breakpoint
COMMENT ON COLUMN app.bot_prompt_template.description IS '模板用途简介';
--> statement-breakpoint
COMMENT ON COLUMN app.bot_prompt_template.body IS '可展开为会话消息的模板正文';
--> statement-breakpoint
COMMENT ON COLUMN app.bot_prompt_template.created_by IS '创建记录的成员标识';
--> statement-breakpoint
COMMENT ON COLUMN app.bot_prompt_template.updated_by IS '最近修改的成员标识';
--> statement-breakpoint
COMMENT ON TABLE app.bot_room_relay IS '由一条成员消息触发的群聊 Bot 接力';
--> statement-breakpoint
COMMENT ON COLUMN app.bot_room_relay.id IS '记录唯一标识';
--> statement-breakpoint
COMMENT ON COLUMN app.bot_room_relay.team_id IS '所属团队标识';
--> statement-breakpoint
COMMENT ON COLUMN app.bot_room_relay.created_at IS '记录创建时间';
--> statement-breakpoint
COMMENT ON COLUMN app.bot_room_relay.updated_at IS '记录最后更新时间';
--> statement-breakpoint
COMMENT ON COLUMN app.bot_room_relay.conversation_id IS '所属房间标识';
--> statement-breakpoint
COMMENT ON COLUMN app.bot_room_relay.origin_message_id IS '触发本轮接力的房间消息标识';
--> statement-breakpoint
COMMENT ON COLUMN app.bot_room_relay.trigger_user_id IS '开始或继续接力的成员标识';
--> statement-breakpoint
COMMENT ON COLUMN app.bot_room_relay.status IS 'running 进行中，paused 暂停，finished 结束，stopped 已停止';
--> statement-breakpoint
COMMENT ON COLUMN app.bot_room_relay.end_reason IS 'completed 已完成，limit 额度到达，stopped_by_member 已停止，budget_exhausted 预算耗尽，ended_by_member 手动结束';
--> statement-breakpoint
COMMENT ON COLUMN app.bot_room_relay.hop_count IS '已进行的 Bot 接力跳数';
--> statement-breakpoint
COMMENT ON COLUMN app.bot_room_relay.reply_count IS '已回复的 Bot 条数';
--> statement-breakpoint
COMMENT ON COLUMN app.bot_room_relay.continue_count IS '成员继续接力的次数';
--> statement-breakpoint
COMMENT ON COLUMN app.bot_room_relay.pending_bot_ids IS '等待回复的 Bot 标识 JSON 数组，顺序即回复顺序';
--> statement-breakpoint
COMMENT ON COLUMN app.bot_room_relay.version IS '并发状态更新的版本';
--> statement-breakpoint
COMMENT ON TABLE app.bot_run_input IS '待投递到已运行 Bot 的房间消息';
--> statement-breakpoint
COMMENT ON COLUMN app.bot_run_input.id IS '记录唯一标识';
--> statement-breakpoint
COMMENT ON COLUMN app.bot_run_input.team_id IS '所属团队标识';
--> statement-breakpoint
COMMENT ON COLUMN app.bot_run_input.created_at IS '记录创建时间';
--> statement-breakpoint
COMMENT ON COLUMN app.bot_run_input.updated_at IS '记录最后更新时间';
--> statement-breakpoint
COMMENT ON COLUMN app.bot_run_input.run_id IS '关联 Bot 运行标识';
--> statement-breakpoint
COMMENT ON COLUMN app.bot_run_input.message_id IS '待投递的房间消息标识';
--> statement-breakpoint
COMMENT ON COLUMN app.bot_run_input.delivery_mode IS 'steer 插话，follow_up 追加';
--> statement-breakpoint
COMMENT ON COLUMN app.bot_run_input.status IS 'pending 待投递，delivered 已投递，requeued 已重新入队';
--> statement-breakpoint
COMMENT ON TABLE app.bot_session IS '会话内单个 Bot 的模型上下文树及同步游标';
--> statement-breakpoint
COMMENT ON COLUMN app.bot_session.id IS '记录唯一标识';
--> statement-breakpoint
COMMENT ON COLUMN app.bot_session.team_id IS '所属团队标识';
--> statement-breakpoint
COMMENT ON COLUMN app.bot_session.created_at IS '记录创建时间';
--> statement-breakpoint
COMMENT ON COLUMN app.bot_session.updated_at IS '记录最后更新时间';
--> statement-breakpoint
COMMENT ON COLUMN app.bot_session.conversation_id IS '所属房间标识';
--> statement-breakpoint
COMMENT ON COLUMN app.bot_session.bot_id IS '关联 Bot 标识';
--> statement-breakpoint
COMMENT ON COLUMN app.bot_session.format_version IS 'Pi 会话条目持久化格式版本';
--> statement-breakpoint
COMMENT ON COLUMN app.bot_session.leaf_entry_id IS '当前分支叶子的条目标识';
--> statement-breakpoint
COMMENT ON COLUMN app.bot_session.synced_message_sequence IS '已同步的最新房间消息序号，零表示尚未同步';
--> statement-breakpoint
COMMENT ON COLUMN app.bot_session.seeded_at IS '首次播种时间，空值表示未播种';
--> statement-breakpoint
COMMENT ON COLUMN app.bot_session.status IS 'active 可使用，detached 已解绑，corrupted 无法恢复';
--> statement-breakpoint
COMMENT ON TABLE app.bot_session_entry IS 'Bot 会话树中按顺序保存的脱敏条目';
--> statement-breakpoint
COMMENT ON COLUMN app.bot_session_entry.id IS '记录唯一标识';
--> statement-breakpoint
COMMENT ON COLUMN app.bot_session_entry.team_id IS '所属团队标识';
--> statement-breakpoint
COMMENT ON COLUMN app.bot_session_entry.created_at IS '记录创建时间';
--> statement-breakpoint
COMMENT ON COLUMN app.bot_session_entry.updated_at IS '记录最后更新时间';
--> statement-breakpoint
COMMENT ON COLUMN app.bot_session_entry.session_id IS '所属 Bot 会话树标识';
--> statement-breakpoint
COMMENT ON COLUMN app.bot_session_entry.entry_id IS '树内的 Pi 条目标识';
--> statement-breakpoint
COMMENT ON COLUMN app.bot_session_entry.parent_entry_id IS '父条目标识，空值表示分支起点';
--> statement-breakpoint
COMMENT ON COLUMN app.bot_session_entry.entry_type IS 'Pi 条目类型，例如 message 消息和 compaction 压缩摘要';
--> statement-breakpoint
COMMENT ON COLUMN app.bot_session_entry.sequence IS '会话树中的写入顺序，从一开始';
--> statement-breakpoint
COMMENT ON COLUMN app.bot_session_entry.content IS '脱敏后的完整 Pi 条目 JSON';
--> statement-breakpoint
COMMENT ON COLUMN app.bot_session_entry.source_message_id IS '关联的房间消息标识，空值表示无关联';
--> statement-breakpoint
COMMENT ON COLUMN app.bot_session_entry.run_id IS '关联 Bot 运行标识';
--> statement-breakpoint
COMMENT ON TABLE app.bot_usage_daily IS '按 UTC 日期归集的团队 Bot 用量';
--> statement-breakpoint
COMMENT ON COLUMN app.bot_usage_daily.id IS '记录唯一标识';
--> statement-breakpoint
COMMENT ON COLUMN app.bot_usage_daily.team_id IS '所属团队标识';
--> statement-breakpoint
COMMENT ON COLUMN app.bot_usage_daily.created_at IS '记录创建时间';
--> statement-breakpoint
COMMENT ON COLUMN app.bot_usage_daily.updated_at IS '记录最后更新时间';
--> statement-breakpoint
COMMENT ON COLUMN app.bot_usage_daily.bot_id IS '关联 Bot 标识';
--> statement-breakpoint
COMMENT ON COLUMN app.bot_usage_daily.usage_date IS 'UTC 用量日期';
--> statement-breakpoint
COMMENT ON COLUMN app.bot_usage_daily.input_tokens IS '输入 Token 数';
--> statement-breakpoint
COMMENT ON COLUMN app.bot_usage_daily.output_tokens IS '输出 Token 数';
--> statement-breakpoint
COMMENT ON COLUMN app.bot_usage_daily.cache_read_tokens IS '缓存命中 Token 数';
--> statement-breakpoint
COMMENT ON COLUMN app.bot_usage_daily.cache_write_tokens IS '缓存写入 Token 数';
--> statement-breakpoint
COMMENT ON COLUMN app.bot_usage_daily.cost_usd IS '已知费用，单位 USD';
--> statement-breakpoint
COMMENT ON COLUMN app.bot_usage_daily.unknown_cost_runs IS '费率未知的运行次数';
--> statement-breakpoint
COMMENT ON TABLE app.team_bot_budget IS '团队每月 Bot 费用预算';
--> statement-breakpoint
COMMENT ON COLUMN app.team_bot_budget.id IS '记录唯一标识';
--> statement-breakpoint
COMMENT ON COLUMN app.team_bot_budget.team_id IS '所属团队标识';
--> statement-breakpoint
COMMENT ON COLUMN app.team_bot_budget.created_at IS '记录创建时间';
--> statement-breakpoint
COMMENT ON COLUMN app.team_bot_budget.updated_at IS '记录最后更新时间';
--> statement-breakpoint
COMMENT ON COLUMN app.team_bot_budget.monthly_limit_usd IS '每月已知费用上限，单位 USD，空值表示不设上限';
--> statement-breakpoint
COMMENT ON COLUMN app.team_bot_budget.updated_by IS '最近修改的成员标识';
--> statement-breakpoint
COMMENT ON TABLE app.team_bot_context IS '团队为 Bot 配置的上下文';
--> statement-breakpoint
COMMENT ON COLUMN app.team_bot_context.id IS '记录唯一标识';
--> statement-breakpoint
COMMENT ON COLUMN app.team_bot_context.team_id IS '所属团队标识';
--> statement-breakpoint
COMMENT ON COLUMN app.team_bot_context.created_at IS '记录创建时间';
--> statement-breakpoint
COMMENT ON COLUMN app.team_bot_context.updated_at IS '记录最后更新时间';
--> statement-breakpoint
COMMENT ON COLUMN app.team_bot_context.content IS '团队 Bot 指令正文，最大 16384 字节';
--> statement-breakpoint
COMMENT ON COLUMN app.team_bot_context.updated_by IS '最近修改的成员标识';
--> statement-breakpoint
COMMENT ON COLUMN app.team_bot_context.version IS '并发编辑控制的版本';
--> statement-breakpoint
COMMENT ON COLUMN app.bot_conversation.forked_from_conversation_id IS '分叉来源会话标识';
--> statement-breakpoint
COMMENT ON COLUMN app.bot_conversation.forked_from_message_id IS '分叉的来源消息标识';
--> statement-breakpoint
COMMENT ON COLUMN app.bot_conversation.active_branch_id IS '当前私聊分支标识';
--> statement-breakpoint
COMMENT ON COLUMN app.bot_memory.source_kind IS 'conversation 会话写入，consolidation 记忆整理写入';
--> statement-breakpoint
COMMENT ON COLUMN app.bot_memory.source_detail IS '可追溯的来源描述及标识 JSON';
--> statement-breakpoint
COMMENT ON COLUMN app.bot_message.branch_id IS '归属的私聊分支标识';
--> statement-breakpoint
COMMENT ON COLUMN app.bot_message.edited_from_message_id IS '编辑重发前的消息标识';
--> statement-breakpoint
COMMENT ON COLUMN app.bot_message.relay_id IS 'Bot 回复关联的接力链标识';
--> statement-breakpoint
COMMENT ON COLUMN app.bot_run.kind IS 'reply 聊天回复，task 任务，compact 主动压缩，memory_consolidation 记忆整理';
--> statement-breakpoint
COMMENT ON COLUMN app.bot_run.relay_id IS '运行关联的接力链标识';
--> statement-breakpoint
COMMENT ON COLUMN app.bot_run.relay_role IS 'leader 默认回复，mention 点名回复，all 全员回复，relay 接力回复';
--> statement-breakpoint
COMMENT ON COLUMN app.bot_run.hop IS '该次回复所处的接力跳数';
--> statement-breakpoint
COMMENT ON COLUMN app.bot_run.resume_count IS '已安排的续跑次数，范围零至二';
--> statement-breakpoint
COMMENT ON COLUMN app.bot_run.is_skipped IS 'Bot 是否主动跳过本次回复';
--> statement-breakpoint
COMMENT ON COLUMN app.bot_run.relay_mentions IS 'Bot 续接点名的标识 JSON 数组，按点名顺序';
