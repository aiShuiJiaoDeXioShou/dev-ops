CREATE TABLE "app"."credential" (
	"id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'active' NOT NULL,
	"current_version" integer DEFAULT 1 NOT NULL,
	"expires_at" timestamp with time zone,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_credential_id" PRIMARY KEY("id"),
	CONSTRAINT "uk_credential_team_name" UNIQUE("team_id","name"),
	CONSTRAINT "ck_credential_kind" CHECK ("app"."credential"."kind" in ('api_key', 'account_password', 'ssh_key')),
	CONSTRAINT "ck_credential_status" CHECK ("app"."credential"."status" in ('active', 'revoked')),
	CONSTRAINT "ck_credential_current_version" CHECK ("app"."credential"."current_version" >= 1),
	CONSTRAINT "ck_credential_name_length" CHECK (char_length("app"."credential"."name") between 1 and 120)
);
--> statement-breakpoint
CREATE TABLE "app"."credential_project_grant" (
	"id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"credential_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"expires_at" timestamp with time zone,
	"granted_by_user_id" uuid NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_credential_project_grant_id" PRIMARY KEY("id"),
	CONSTRAINT "uk_credential_project_grant" UNIQUE("credential_id","project_id")
);
--> statement-breakpoint
CREATE TABLE "app"."credential_usage" (
	"id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"credential_id" uuid NOT NULL,
	"credential_version" integer NOT NULL,
	"project_id" uuid,
	"environment" text,
	"action" text NOT NULL,
	"actor_user_id" uuid,
	"result" text NOT NULL,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_credential_usage_id" PRIMARY KEY("id"),
	CONSTRAINT "ck_credential_usage_action" CHECK ("app"."credential_usage"."action" in ('use', 'create', 'rotate', 'revoke', 'grant', 'revoke_grant', 'read_metadata')),
	CONSTRAINT "ck_credential_usage_result" CHECK ("app"."credential_usage"."result" in ('success', 'denied', 'expired', 'failed')),
	CONSTRAINT "ck_credential_usage_environment" CHECK ("app"."credential_usage"."environment" is null or "app"."credential_usage"."environment" in ('development', 'test', 'production'))
);
--> statement-breakpoint
CREATE TABLE "app"."credential_version" (
	"id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"credential_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"ciphertext" text NOT NULL,
	"iv" text NOT NULL,
	"auth_tag" text NOT NULL,
	"key_version" smallint NOT NULL,
	"rotated_from_version" integer,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_credential_version_id" PRIMARY KEY("id"),
	CONSTRAINT "uk_credential_version" UNIQUE("credential_id","version"),
	CONSTRAINT "ck_credential_version_positive" CHECK ("app"."credential_version"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "app"."external_review" (
	"id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"service_id" uuid,
	"target_type" text NOT NULL,
	"version_label" text NOT NULL,
	"review_platform" text NOT NULL,
	"submitted_at" timestamp with time zone NOT NULL,
	"submitted_by_user_id" uuid NOT NULL,
	"note" text,
	"evidence_url" text,
	"review_status" text NOT NULL,
	"review_reason" text,
	"reviewed_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_external_review_id" PRIMARY KEY("id"),
	CONSTRAINT "ck_external_review_target" CHECK ("app"."external_review"."target_type" in ('mini_program', 'mobile_app')),
	CONSTRAINT "ck_external_review_status" CHECK ("app"."external_review"."review_status" in ('pending', 'approved', 'rejected', 'withdrawn', 'unknown'))
);
--> statement-breakpoint
CREATE TABLE "app"."pipeline_run" (
	"id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"service_id" uuid,
	"pipeline_name" text NOT NULL,
	"pipeline_key" text NOT NULL,
	"commit_ref" text,
	"trigger_source" text NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"result_url" text,
	"source" text NOT NULL,
	"source_run_id" text NOT NULL,
	"last_reported_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_pipeline_run_id" PRIMARY KEY("id"),
	CONSTRAINT "uk_pipeline_run_identity" UNIQUE("project_id","source","source_run_id"),
	CONSTRAINT "ck_pipeline_run_status" CHECK ("app"."pipeline_run"."status" in ('queued', 'running', 'succeeded', 'failed', 'cancelled', 'unknown')),
	CONSTRAINT "ck_pipeline_run_trigger" CHECK ("app"."pipeline_run"."trigger_source" in ('manual', 'push', 'schedule', 'external', 'unknown'))
);
--> statement-breakpoint
CREATE TABLE "app"."pipeline_run_status" (
	"id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"pipeline_run_id" uuid NOT NULL,
	"status" text NOT NULL,
	"reported_at" timestamp with time zone NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_pipeline_run_status_id" PRIMARY KEY("id"),
	CONSTRAINT "ck_pipeline_run_status_value" CHECK ("app"."pipeline_run_status"."status" in ('queued', 'running', 'succeeded', 'failed', 'cancelled', 'unknown'))
);
--> statement-breakpoint
CREATE TABLE "app"."project_env_var" (
	"id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"environment" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"value_text" text,
	"credential_id" uuid,
	"status" text DEFAULT 'active' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_project_env_var_id" PRIMARY KEY("id"),
	CONSTRAINT "uk_project_env_var" UNIQUE("project_id","environment","name"),
	CONSTRAINT "ck_project_env_var_environment" CHECK ("app"."project_env_var"."environment" in ('development', 'test', 'production')),
	CONSTRAINT "ck_project_env_var_kind" CHECK ("app"."project_env_var"."kind" in ('plain', 'credential_ref')),
	CONSTRAINT "ck_project_env_var_status" CHECK ("app"."project_env_var"."status" in ('active', 'invalid')),
	CONSTRAINT "ck_project_env_var_ref" CHECK (("app"."project_env_var"."kind" = 'credential_ref' and "app"."project_env_var"."credential_id" is not null and "app"."project_env_var"."value_text" is null) or ("app"."project_env_var"."kind" = 'plain' and "app"."project_env_var"."credential_id" is null and "app"."project_env_var"."value_text" is not null)),
	CONSTRAINT "ck_project_env_var_name_length" CHECK (char_length("app"."project_env_var"."name") between 1 and 120),
	CONSTRAINT "ck_project_env_var_version" CHECK ("app"."project_env_var"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "app"."release_result" (
	"id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"review_id" uuid,
	"service_id" uuid,
	"version_label" text NOT NULL,
	"release_status" text NOT NULL,
	"released_at" timestamp with time zone,
	"scope_note" text,
	"evidence_url" text,
	"version" integer DEFAULT 1 NOT NULL,
	"recorded_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_release_result_id" PRIMARY KEY("id"),
	CONSTRAINT "ck_release_result_status" CHECK ("app"."release_result"."release_status" in ('not_released', 'released', 'partially_released', 'unknown'))
);
--> statement-breakpoint
CREATE TABLE "app"."service_run_version" (
	"id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"environment" text NOT NULL,
	"version_label" text,
	"source" text NOT NULL,
	"evidence_url" text,
	"verification_status" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"confirmed_by_user_id" uuid,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_service_run_version_id" PRIMARY KEY("id"),
	CONSTRAINT "uk_service_run_version" UNIQUE("service_id","environment"),
	CONSTRAINT "ck_service_run_version_env" CHECK ("app"."service_run_version"."environment" in ('development', 'test', 'production')),
	CONSTRAINT "ck_service_run_version_status" CHECK ("app"."service_run_version"."verification_status" in ('confirmed', 'pending', 'unknown')),
	CONSTRAINT "ck_service_run_version_source" CHECK ("app"."service_run_version"."source" in ('manual', 'deployment_receipt'))
);
--> statement-breakpoint
CREATE TABLE "app"."service_run_version_change" (
	"id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"environment" text NOT NULL,
	"previous_version_label" text,
	"new_version_label" text,
	"previous_status" text NOT NULL,
	"new_status" text NOT NULL,
	"source" text NOT NULL,
	"evidence_url" text,
	"reason" text,
	"changed_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_service_run_version_change_id" PRIMARY KEY("id"),
	CONSTRAINT "ck_service_run_version_change_env" CHECK ("app"."service_run_version_change"."environment" in ('development', 'test', 'production')),
	CONSTRAINT "ck_service_run_version_change_prev_status" CHECK ("app"."service_run_version_change"."previous_status" in ('confirmed', 'pending', 'unknown')),
	CONSTRAINT "ck_service_run_version_change_new_status" CHECK ("app"."service_run_version_change"."new_status" in ('confirmed', 'pending', 'unknown'))
);
--> statement-breakpoint
CREATE INDEX "idx_credential_team_status" ON "app"."credential" USING btree ("team_id","status","updated_at");--> statement-breakpoint
CREATE INDEX "idx_credential_project_grant_project" ON "app"."credential_project_grant" USING btree ("project_id","revoked_at");--> statement-breakpoint
CREATE INDEX "idx_credential_usage_credential" ON "app"."credential_usage" USING btree ("credential_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_credential_usage_team" ON "app"."credential_usage" USING btree ("team_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_credential_version_credential" ON "app"."credential_version" USING btree ("credential_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_external_review_project_time" ON "app"."external_review" USING btree ("project_id","submitted_at");--> statement-breakpoint
CREATE INDEX "idx_pipeline_run_project_time" ON "app"."pipeline_run" USING btree ("project_id","started_at");--> statement-breakpoint
CREATE INDEX "idx_pipeline_run_status_run" ON "app"."pipeline_run_status" USING btree ("pipeline_run_id","reported_at","id");--> statement-breakpoint
CREATE INDEX "idx_project_env_var_project_env" ON "app"."project_env_var" USING btree ("project_id","environment","name");--> statement-breakpoint
CREATE INDEX "idx_release_result_project_time" ON "app"."release_result" USING btree ("project_id","released_at");--> statement-breakpoint
CREATE INDEX "idx_service_run_version_change_service" ON "app"."service_run_version_change" USING btree ("service_id","environment","created_at");