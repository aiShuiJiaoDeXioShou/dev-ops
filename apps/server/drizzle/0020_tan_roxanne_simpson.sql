DROP TABLE IF EXISTS "app"."pipeline_run_status" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "app"."pipeline_run" CASCADE;--> statement-breakpoint
CREATE TABLE "app"."pipeline_artifact" (
	"id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"step_index" integer NOT NULL,
	"name" text NOT NULL,
	"storage_key" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"sha256" text NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_pipeline_artifact_id" PRIMARY KEY("id"),
	CONSTRAINT "uk_pipeline_artifact_run_name" UNIQUE("run_id","name"),
	CONSTRAINT "ck_pipeline_artifact_status" CHECK ("app"."pipeline_artifact"."status" in ('available', 'missing', 'failed')),
	CONSTRAINT "ck_pipeline_artifact_sha256" CHECK (char_length("app"."pipeline_artifact"."sha256") = 64),
	CONSTRAINT "ck_pipeline_artifact_size" CHECK ("app"."pipeline_artifact"."size_bytes" >= 0)
);
--> statement-breakpoint
CREATE TABLE "app"."pipeline_lease" (
	"id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"node_id" uuid NOT NULL,
	"lease_token_hash" text NOT NULL,
	"status" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"renewed_at" timestamp with time zone,
	"released_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_pipeline_lease_id" PRIMARY KEY("id"),
	CONSTRAINT "ck_pipeline_lease_status" CHECK ("app"."pipeline_lease"."status" in ('active', 'released', 'expired'))
);
--> statement-breakpoint
CREATE TABLE "app"."pipeline_node" (
	"id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"name" text NOT NULL,
	"status" text NOT NULL,
	"os" text NOT NULL,
	"arch" text NOT NULL,
	"capabilities" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"concurrency_limit" integer DEFAULT 1 NOT NULL,
	"agent_version" text,
	"last_heartbeat_at" timestamp with time zone,
	"last_error_code" text,
	"created_by_user_id" uuid NOT NULL,
	"disabled_at" timestamp with time zone,
	"disabled_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_pipeline_node_id" PRIMARY KEY("id"),
	CONSTRAINT "uk_pipeline_node_team_name" UNIQUE("team_id","name"),
	CONSTRAINT "ck_pipeline_node_status" CHECK ("app"."pipeline_node"."status" in ('pending', 'online', 'draining', 'offline', 'disabled')),
	CONSTRAINT "ck_pipeline_node_concurrency" CHECK ("app"."pipeline_node"."concurrency_limit" > 0 and "app"."pipeline_node"."concurrency_limit" <= 1)
);
--> statement-breakpoint
CREATE TABLE "app"."pipeline_node_token" (
	"id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"node_id" uuid NOT NULL,
	"token_kind" text NOT NULL,
	"token_hash" text NOT NULL,
	"status" text NOT NULL,
	"expires_at" timestamp with time zone,
	"used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoked_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_pipeline_node_token_id" PRIMARY KEY("id"),
	CONSTRAINT "uk_pipeline_node_token_hash" UNIQUE("token_hash"),
	CONSTRAINT "ck_pipeline_node_token_kind" CHECK ("app"."pipeline_node_token"."token_kind" in ('registration', 'agent')),
	CONSTRAINT "ck_pipeline_node_token_status" CHECK ("app"."pipeline_node_token"."status" in ('active', 'used', 'revoked', 'expired'))
);
--> statement-breakpoint
CREATE TABLE "app"."pipeline_run_log" (
	"id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"step_index" integer NOT NULL,
	"seq" integer NOT NULL,
	"storage_key" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_pipeline_run_log_id" PRIMARY KEY("id"),
	CONSTRAINT "uk_pipeline_run_log_chunk" UNIQUE("run_id","step_index","seq"),
	CONSTRAINT "ck_pipeline_run_log_seq" CHECK ("app"."pipeline_run_log"."seq" >= 0 and "app"."pipeline_run_log"."step_index" >= 0)
);
--> statement-breakpoint
CREATE TABLE "app"."pipeline_run_step" (
	"id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"step_index" integer NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"exit_code" integer,
	"error_code" text,
	"error_message" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_pipeline_run_step_id" PRIMARY KEY("id"),
	CONSTRAINT "uk_pipeline_run_step" UNIQUE("run_id","step_index"),
	CONSTRAINT "ck_pipeline_run_step_status" CHECK ("app"."pipeline_run_step"."status" in ('pending', 'running', 'succeeded', 'failed', 'skipped', 'cancelled')),
	CONSTRAINT "ck_pipeline_run_step_kind" CHECK ("app"."pipeline_run_step"."kind" in ('run', 'builtin_checkout', 'builtin_upload_artifact'))
);
--> statement-breakpoint
CREATE INDEX "idx_pipeline_artifact_run" ON "app"."pipeline_artifact" USING btree ("run_id","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "uk_pipeline_lease_active_run" ON "app"."pipeline_lease" USING btree ("run_id") WHERE "app"."pipeline_lease"."status" = 'active';--> statement-breakpoint
CREATE INDEX "idx_pipeline_lease_node" ON "app"."pipeline_lease" USING btree ("node_id","status","expires_at");--> statement-breakpoint
CREATE INDEX "idx_pipeline_node_team_status" ON "app"."pipeline_node" USING btree ("team_id","status");--> statement-breakpoint
CREATE INDEX "idx_pipeline_node_capabilities" ON "app"."pipeline_node" USING gin ("capabilities");--> statement-breakpoint
CREATE INDEX "idx_pipeline_node_token_node" ON "app"."pipeline_node_token" USING btree ("node_id","token_kind","status");--> statement-breakpoint
CREATE INDEX "idx_pipeline_run_log_read" ON "app"."pipeline_run_log" USING btree ("run_id","step_index","seq");--> statement-breakpoint
CREATE INDEX "idx_pipeline_run_step_run" ON "app"."pipeline_run_step" USING btree ("run_id","step_index");--> statement-breakpoint
CREATE TABLE "app"."pipeline_run" (
	"id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"repository_id" uuid NOT NULL,
	"workflow_path" text NOT NULL,
	"workflow_name" text,
	"git_ref" text NOT NULL,
	"commit_sha" text NOT NULL,
	"inputs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"run_plan" jsonb NOT NULL,
	"workflow_snapshot" text NOT NULL,
	"workflow_hash" text NOT NULL,
	"status" text NOT NULL,
	"trigger_source" text NOT NULL,
	"initiator_channel" text NOT NULL,
	"triggered_by_user_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"node_id" uuid,
	"timeout_seconds" integer NOT NULL,
	"error_code" text,
	"error_message" text,
	"cancel_requested_at" timestamp with time zone,
	"cancel_requested_by_user_id" uuid,
	"assigned_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_pipeline_run_id" PRIMARY KEY("id"),
	CONSTRAINT "uk_pipeline_run_idempotency" UNIQUE("project_id","idempotency_key"),
	CONSTRAINT "ck_pipeline_run_status" CHECK ("app"."pipeline_run"."status" in ('queued', 'assigned', 'running', 'cancelling', 'succeeded', 'failed', 'cancelled', 'interrupted')),
	CONSTRAINT "ck_pipeline_run_trigger" CHECK ("app"."pipeline_run"."trigger_source" in ('manual')),
	CONSTRAINT "ck_pipeline_run_channel" CHECK ("app"."pipeline_run"."initiator_channel" in ('web', 'api'))
);--> statement-breakpoint
CREATE INDEX "idx_pipeline_run_status" ON "app"."pipeline_run" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "idx_pipeline_run_node" ON "app"."pipeline_run" USING btree ("node_id","status");--> statement-breakpoint
CREATE INDEX "idx_pipeline_run_project_time" ON "app"."pipeline_run" USING btree ("project_id","created_at","id");--> statement-breakpoint
