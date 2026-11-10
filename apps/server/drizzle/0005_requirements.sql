CREATE TABLE "app"."requirement" (
	"id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"title" text NOT NULL,
	"content_mode" text NOT NULL,
	"content_markdown" text,
	"external_url" text,
	"external_summary" text,
	"acceptance_criteria" text,
	"dev_owner_user_id" uuid,
	"test_owner_user_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_requirement_id" PRIMARY KEY("id"),
	CONSTRAINT "uk_requirement_project_number" UNIQUE("project_id","number"),
	CONSTRAINT "ck_requirement_content_mode" CHECK ("app"."requirement"."content_mode" in ('markdown', 'external_link')),
	CONSTRAINT "ck_requirement_status" CHECK ("app"."requirement"."status" in ('pending', 'in_development', 'submitted', 'in_testing', 'passed', 'cancelled')),
	CONSTRAINT "ck_requirement_content_fields" CHECK ((
    ("app"."requirement"."content_mode" = 'markdown' AND "app"."requirement"."content_markdown" IS NOT NULL AND length(btrim("app"."requirement"."content_markdown")) > 0)
    OR ("app"."requirement"."content_mode" = 'external_link' AND "app"."requirement"."external_url" IS NOT NULL AND length(btrim("app"."requirement"."external_url")) > 0)
  ))
);
--> statement-breakpoint
CREATE TABLE "app"."requirement_collaborator" (
	"id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"requirement_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_requirement_collaborator_id" PRIMARY KEY("id"),
	CONSTRAINT "uk_requirement_collaborator" UNIQUE("requirement_id","user_id")
);
--> statement-breakpoint
CREATE INDEX "idx_requirement_project_status" ON "app"."requirement" USING btree ("project_id","status","updated_at","id");--> statement-breakpoint
CREATE INDEX "idx_requirement_project_owner" ON "app"."requirement" USING btree ("project_id","dev_owner_user_id");--> statement-breakpoint
CREATE INDEX "idx_requirement_team" ON "app"."requirement" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "idx_requirement_collaborator_user" ON "app"."requirement_collaborator" USING btree ("user_id");
COMMENT ON TABLE "app"."requirement" IS '项目需求事项';
COMMENT ON COLUMN "app"."requirement"."id" IS '需求主键（UUID）';
COMMENT ON COLUMN "app"."requirement"."team_id" IS '所属团队标识';
COMMENT ON COLUMN "app"."requirement"."project_id" IS '所属项目标识';
COMMENT ON COLUMN "app"."requirement"."number" IS '项目内稳定编号';
COMMENT ON COLUMN "app"."requirement"."title" IS '需求标题';
COMMENT ON COLUMN "app"."requirement"."content_mode" IS '内容方式：markdown、external_link';
COMMENT ON COLUMN "app"."requirement"."content_markdown" IS '内置 Markdown 正文';
COMMENT ON COLUMN "app"."requirement"."external_url" IS '外部文档链接';
COMMENT ON COLUMN "app"."requirement"."external_summary" IS '外部文档本地摘要';
COMMENT ON COLUMN "app"."requirement"."acceptance_criteria" IS '验收标准';
COMMENT ON COLUMN "app"."requirement"."dev_owner_user_id" IS '研发主负责人标识';
COMMENT ON COLUMN "app"."requirement"."test_owner_user_id" IS '测试负责人标识';
COMMENT ON COLUMN "app"."requirement"."status" IS '业务状态：pending、in_development、submitted、in_testing、passed、cancelled';
COMMENT ON COLUMN "app"."requirement"."version" IS '乐观锁版本号';
COMMENT ON COLUMN "app"."requirement"."created_by_user_id" IS '创建者用户标识';
COMMENT ON COLUMN "app"."requirement"."created_at" IS '创建时间';
COMMENT ON COLUMN "app"."requirement"."updated_at" IS '更新时间';

COMMENT ON TABLE "app"."requirement_collaborator" IS '需求协作人员';
COMMENT ON COLUMN "app"."requirement_collaborator"."id" IS '协作关系主键（UUID）';
COMMENT ON COLUMN "app"."requirement_collaborator"."team_id" IS '所属团队标识';
COMMENT ON COLUMN "app"."requirement_collaborator"."requirement_id" IS '需求标识';
COMMENT ON COLUMN "app"."requirement_collaborator"."user_id" IS '协作用户标识';
COMMENT ON COLUMN "app"."requirement_collaborator"."created_by_user_id" IS '添加者用户标识';
COMMENT ON COLUMN "app"."requirement_collaborator"."created_at" IS '创建时间';
COMMENT ON COLUMN "app"."requirement_collaborator"."updated_at" IS '更新时间';
