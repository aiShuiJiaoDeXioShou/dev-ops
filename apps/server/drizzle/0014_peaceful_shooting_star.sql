CREATE TABLE "app"."build_artifact" (
	"id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"build_id" uuid NOT NULL,
	"artifact_type" text NOT NULL,
	"version_label" text NOT NULL,
	"access_url" text NOT NULL,
	"source" text NOT NULL,
	"collected_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'available' NOT NULL,
	"note" text,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_build_artifact_id" PRIMARY KEY("id"),
	CONSTRAINT "ck_build_artifact_type" CHECK ("app"."build_artifact"."artifact_type" in ('mobile_package', 'mini_program_qr', 'web_test_url')),
	CONSTRAINT "ck_build_artifact_status" CHECK ("app"."build_artifact"."status" in ('available', 'expired', 'invalid')),
	CONSTRAINT "ck_build_artifact_source" CHECK ("app"."build_artifact"."source" in ('manual', 'pipeline', 'external_system'))
);
--> statement-breakpoint
CREATE TABLE "app"."build_record" (
	"id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"service_id" uuid,
	"environment" text,
	"build_key" text NOT NULL,
	"version_label" text NOT NULL,
	"commit_ref" text,
	"source" text NOT NULL,
	"source_run_id" text,
	"collected_at" timestamp with time zone NOT NULL,
	"result_status" text NOT NULL,
	"note" text,
	"version" integer DEFAULT 1 NOT NULL,
	"reported_by_user_id" uuid NOT NULL,
	"reporter_kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_build_record_id" PRIMARY KEY("id"),
	CONSTRAINT "uk_build_record_identity" UNIQUE("project_id","source","build_key"),
	CONSTRAINT "ck_build_record_environment" CHECK ("app"."build_record"."environment" is null or "app"."build_record"."environment" in ('development', 'test', 'production')),
	CONSTRAINT "ck_build_record_status" CHECK ("app"."build_record"."result_status" in ('succeeded', 'failed', 'cancelled', 'unknown')),
	CONSTRAINT "ck_build_record_source" CHECK ("app"."build_record"."source" in ('pipeline', 'local', 'external_system', 'manual')),
	CONSTRAINT "ck_build_record_reporter" CHECK ("app"."build_record"."reporter_kind" in ('web', 'api_token', 'cli'))
);
--> statement-breakpoint
CREATE TABLE "app"."build_record_correction" (
	"id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"build_id" uuid NOT NULL,
	"previous_snapshot" jsonb NOT NULL,
	"corrected_fields" jsonb NOT NULL,
	"reason" text NOT NULL,
	"corrected_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_build_record_correction_id" PRIMARY KEY("id")
);
--> statement-breakpoint
CREATE TABLE "app"."build_record_target" (
	"id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"build_id" uuid NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_build_record_target_id" PRIMARY KEY("id"),
	CONSTRAINT "uk_build_record_target" UNIQUE("build_id","target_type","target_id"),
	CONSTRAINT "ck_build_record_target_type" CHECK ("app"."build_record_target"."target_type" in ('requirement', 'bug'))
);
--> statement-breakpoint
CREATE TABLE "app"."project_service" (
	"id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'active' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_project_service_id" PRIMARY KEY("id"),
	CONSTRAINT "uk_project_service_project_name" UNIQUE("project_id","name"),
	CONSTRAINT "ck_project_service_status" CHECK ("app"."project_service"."status" in ('active', 'disabled')),
	CONSTRAINT "ck_project_service_name_length" CHECK (char_length("app"."project_service"."name") between 1 and 120)
);
--> statement-breakpoint
CREATE TABLE "app"."project_service_repository" (
	"id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"repository_id" uuid NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_project_service_repository_id" PRIMARY KEY("id"),
	CONSTRAINT "uk_project_service_repository" UNIQUE("service_id","repository_id")
);
--> statement-breakpoint
ALTER TABLE "app"."activity" DROP CONSTRAINT "ck_activity_entity_type";--> statement-breakpoint
ALTER TABLE "app"."team" ADD COLUMN "icon_text" text;--> statement-breakpoint
ALTER TABLE "app"."team" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "app"."team" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_build_artifact_build" ON "app"."build_artifact" USING btree ("build_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_build_artifact_project_type" ON "app"."build_artifact" USING btree ("project_id","artifact_type","collected_at");--> statement-breakpoint
CREATE INDEX "idx_build_record_project_time" ON "app"."build_record" USING btree ("project_id","collected_at","id");--> statement-breakpoint
CREATE INDEX "idx_build_record_service_time" ON "app"."build_record" USING btree ("service_id","collected_at");--> statement-breakpoint
CREATE INDEX "idx_build_record_correction_build" ON "app"."build_record_correction" USING btree ("build_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_build_record_target_target" ON "app"."build_record_target" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "idx_project_service_project_status" ON "app"."project_service" USING btree ("project_id","status","updated_at","id");--> statement-breakpoint
CREATE INDEX "idx_project_service_team" ON "app"."project_service" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "idx_project_service_repository_repository" ON "app"."project_service_repository" USING btree ("repository_id");--> statement-breakpoint
CREATE INDEX "idx_project_service_repository_project" ON "app"."project_service_repository" USING btree ("project_id");--> statement-breakpoint
ALTER TABLE "app"."activity" ADD CONSTRAINT "ck_activity_entity_type" CHECK ("app"."activity"."entity_type" in ('project', 'requirement', 'bug', 'code_reference', 'team_member', 'team', 'project_service', 'build_record', 'build_artifact', 'service_run_version', 'pipeline_run', 'external_review', 'release_result', 'credential', 'credential_grant', 'project_env_var'));