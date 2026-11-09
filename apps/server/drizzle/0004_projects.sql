CREATE TABLE "app"."project" (
	"id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"owner_user_id" uuid NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_project_id" PRIMARY KEY("id"),
	CONSTRAINT "uk_project_team_name" UNIQUE("team_id","name"),
	CONSTRAINT "ck_project_status" CHECK ("app"."project"."status" in ('active', 'paused', 'ended'))
);
--> statement-breakpoint
CREATE INDEX "idx_project_team_status" ON "app"."project" USING btree ("team_id","status","updated_at","id");--> statement-breakpoint
CREATE INDEX "idx_project_owner" ON "app"."project" USING btree ("team_id","owner_user_id");
COMMENT ON TABLE "app"."project" IS '团队内的项目容器';
COMMENT ON COLUMN "app"."project"."id" IS '项目主键（UUID）';
COMMENT ON COLUMN "app"."project"."team_id" IS '所属团队标识';
COMMENT ON COLUMN "app"."project"."name" IS '项目名称，同团队唯一';
COMMENT ON COLUMN "app"."project"."description" IS '项目说明';
COMMENT ON COLUMN "app"."project"."owner_user_id" IS '项目负责人用户标识';
COMMENT ON COLUMN "app"."project"."status" IS '项目状态：active、paused、ended';
COMMENT ON COLUMN "app"."project"."version" IS '乐观锁版本号';
COMMENT ON COLUMN "app"."project"."created_by_user_id" IS '创建者用户标识';
COMMENT ON COLUMN "app"."project"."created_at" IS '创建时间';
COMMENT ON COLUMN "app"."project"."updated_at" IS '更新时间';
