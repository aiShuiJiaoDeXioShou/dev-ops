CREATE TABLE "app"."code_reference" (
	"id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"repository_id" uuid NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid NOT NULL,
	"object_type" text NOT NULL,
	"remote_id" text NOT NULL,
	"title_snapshot" text,
	"state_snapshot" text,
	"url" text,
	"last_checked_at" timestamp with time zone,
	"last_check_status" text DEFAULT 'unknown' NOT NULL,
	"last_error_code" text,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_code_reference_id" PRIMARY KEY("id"),
	CONSTRAINT "uk_code_reference_target" UNIQUE("repository_id","object_type","remote_id","target_type","target_id"),
	CONSTRAINT "ck_code_reference_target_type" CHECK ("app"."code_reference"."target_type" in ('requirement', 'bug')),
	CONSTRAINT "ck_code_reference_object_type" CHECK ("app"."code_reference"."object_type" in ('commit', 'issue', 'change_request')),
	CONSTRAINT "ck_code_reference_check_status" CHECK ("app"."code_reference"."last_check_status" in ('unknown', 'ok', 'unavailable', 'auth_failed', 'not_found', 'timeout'))
);
--> statement-breakpoint
CREATE TABLE "app"."git_repository" (
	"id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"provider_key" text NOT NULL,
	"remote_repository_id" text NOT NULL,
	"namespace" text NOT NULL,
	"name" text NOT NULL,
	"web_url" text NOT NULL,
	"default_branch" text,
	"status" text DEFAULT 'available' NOT NULL,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_git_repository_id" PRIMARY KEY("id"),
	CONSTRAINT "uk_git_repository_remote" UNIQUE("connection_id","remote_repository_id"),
	CONSTRAINT "ck_git_repository_status" CHECK ("app"."git_repository"."status" in ('available', 'unavailable', 'removed'))
);
--> statement-breakpoint
CREATE TABLE "app"."project_repository" (
	"id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"repository_id" uuid NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_project_repository_id" PRIMARY KEY("id"),
	CONSTRAINT "uk_project_repository" UNIQUE("project_id","repository_id")
);
--> statement-breakpoint
CREATE INDEX "idx_code_reference_target" ON "app"."code_reference" USING btree ("project_id","target_type","target_id");--> statement-breakpoint
CREATE INDEX "idx_code_reference_repository" ON "app"."code_reference" USING btree ("repository_id","last_checked_at");--> statement-breakpoint
CREATE INDEX "idx_git_repository_team" ON "app"."git_repository" USING btree ("team_id","provider_key");--> statement-breakpoint
CREATE INDEX "idx_git_repository_connection" ON "app"."git_repository" USING btree ("connection_id");--> statement-breakpoint
CREATE INDEX "idx_project_repository_repository" ON "app"."project_repository" USING btree ("repository_id");
COMMENT ON TABLE "app"."git_repository" IS 'Git 连接同步的远端仓库快照';
COMMENT ON COLUMN "app"."git_repository"."id" IS '仓库主键（UUID）';
COMMENT ON COLUMN "app"."git_repository"."team_id" IS '所属团队标识';
COMMENT ON COLUMN "app"."git_repository"."connection_id" IS '所属 Git 连接标识';
COMMENT ON COLUMN "app"."git_repository"."provider_key" IS '提供方：github、gitea';
COMMENT ON COLUMN "app"."git_repository"."remote_repository_id" IS '远端仓库稳定标识';
COMMENT ON COLUMN "app"."git_repository"."namespace" IS '远端命名空间';
COMMENT ON COLUMN "app"."git_repository"."name" IS '远端仓库名';
COMMENT ON COLUMN "app"."git_repository"."web_url" IS '远端 Web 地址';
COMMENT ON COLUMN "app"."git_repository"."default_branch" IS '默认分支';
COMMENT ON COLUMN "app"."git_repository"."status" IS '状态：available、unavailable、removed';
COMMENT ON COLUMN "app"."git_repository"."last_synced_at" IS '最近同步时间';
COMMENT ON COLUMN "app"."git_repository"."created_at" IS '创建时间';
COMMENT ON COLUMN "app"."git_repository"."updated_at" IS '更新时间';

COMMENT ON TABLE "app"."project_repository" IS '项目与仓库的显式关联';
COMMENT ON COLUMN "app"."project_repository"."id" IS '关联主键（UUID）';
COMMENT ON COLUMN "app"."project_repository"."team_id" IS '所属团队标识';
COMMENT ON COLUMN "app"."project_repository"."project_id" IS '项目标识';
COMMENT ON COLUMN "app"."project_repository"."repository_id" IS '仓库标识';
COMMENT ON COLUMN "app"."project_repository"."created_by_user_id" IS '创建者用户标识';
COMMENT ON COLUMN "app"."project_repository"."created_at" IS '创建时间';
COMMENT ON COLUMN "app"."project_repository"."updated_at" IS '更新时间';

COMMENT ON TABLE "app"."code_reference" IS '事项与远端 Commit/Issue/PR 的引用';
COMMENT ON COLUMN "app"."code_reference"."id" IS '引用主键（UUID）';
COMMENT ON COLUMN "app"."code_reference"."team_id" IS '所属团队标识';
COMMENT ON COLUMN "app"."code_reference"."project_id" IS '所属项目标识';
COMMENT ON COLUMN "app"."code_reference"."repository_id" IS '仓库标识';
COMMENT ON COLUMN "app"."code_reference"."target_type" IS '事项类型：requirement、bug';
COMMENT ON COLUMN "app"."code_reference"."target_id" IS '事项标识';
COMMENT ON COLUMN "app"."code_reference"."object_type" IS '远端对象类型：commit、issue、change_request';
COMMENT ON COLUMN "app"."code_reference"."remote_id" IS '远端对象标识';
COMMENT ON COLUMN "app"."code_reference"."title_snapshot" IS '最近核对标题快照';
COMMENT ON COLUMN "app"."code_reference"."state_snapshot" IS '最近核对状态快照';
COMMENT ON COLUMN "app"."code_reference"."url" IS '远端 Web 地址';
COMMENT ON COLUMN "app"."code_reference"."last_checked_at" IS '最近核对时间';
COMMENT ON COLUMN "app"."code_reference"."last_check_status" IS '最近核对状态';
COMMENT ON COLUMN "app"."code_reference"."last_error_code" IS '最近错误码';
COMMENT ON COLUMN "app"."code_reference"."created_by_user_id" IS '创建者用户标识';
COMMENT ON COLUMN "app"."code_reference"."created_at" IS '创建时间';
COMMENT ON COLUMN "app"."code_reference"."updated_at" IS '更新时间';
