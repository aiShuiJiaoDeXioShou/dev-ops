CREATE TABLE "app"."git_connection" (
	"id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"provider_key" text NOT NULL,
	"instance_url" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"auth_kind" text NOT NULL,
	"external_identity" text,
	"secret_id" uuid,
	"repository_scope_synced_at" timestamp with time zone,
	"last_checked_at" timestamp with time zone,
	"last_error_code" text,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_git_connection_id" PRIMARY KEY("id"),
	CONSTRAINT "uk_git_connection_team_name" UNIQUE("team_id","name"),
	CONSTRAINT "ck_git_connection_provider" CHECK ("app"."git_connection"."provider_key" in ('github', 'gitea')),
	CONSTRAINT "ck_git_connection_status" CHECK ("app"."git_connection"."status" in ('active', 'invalid', 'revoked')),
	CONSTRAINT "ck_git_connection_auth_kind" CHECK ("app"."git_connection"."auth_kind" in ('github_app_installation', 'github_cli', 'gitea_token'))
);
--> statement-breakpoint
CREATE INDEX "idx_git_connection_team_status" ON "app"."git_connection" USING btree ("team_id","status");
COMMENT ON TABLE "app"."git_connection" IS '团队 Git 连接';
COMMENT ON COLUMN "app"."git_connection"."id" IS '连接主键（UUID）';
COMMENT ON COLUMN "app"."git_connection"."team_id" IS '所属团队标识';
COMMENT ON COLUMN "app"."git_connection"."provider_key" IS '提供方：github、gitea';
COMMENT ON COLUMN "app"."git_connection"."instance_url" IS '实例基址';
COMMENT ON COLUMN "app"."git_connection"."name" IS '连接名称，团队内唯一';
COMMENT ON COLUMN "app"."git_connection"."status" IS '状态：active、invalid、revoked';
COMMENT ON COLUMN "app"."git_connection"."auth_kind" IS '授权方式：github_app_installation、github_cli、gitea_token';
COMMENT ON COLUMN "app"."git_connection"."external_identity" IS '外部授权身份摘要';
COMMENT ON COLUMN "app"."git_connection"."secret_id" IS '加密凭据标识';
COMMENT ON COLUMN "app"."git_connection"."repository_scope_synced_at" IS '仓库范围最近同步时间';
COMMENT ON COLUMN "app"."git_connection"."last_checked_at" IS '最近检查时间';
COMMENT ON COLUMN "app"."git_connection"."last_error_code" IS '最近错误码';
COMMENT ON COLUMN "app"."git_connection"."created_by_user_id" IS '创建者用户标识';
COMMENT ON COLUMN "app"."git_connection"."created_at" IS '创建时间';
COMMENT ON COLUMN "app"."git_connection"."updated_at" IS '更新时间';
