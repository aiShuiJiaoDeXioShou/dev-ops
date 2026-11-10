CREATE TABLE "app"."agent_template" (
	"id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"name" varchar(40) NOT NULL,
	"name_normalized" varchar(40) NOT NULL,
	"tag" varchar(30) NOT NULL,
	"description" varchar(200),
	"current_version_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_agent_template_id" PRIMARY KEY("id"),
	CONSTRAINT "uk_agent_template_team_normalized_name" UNIQUE("team_id","name_normalized")
);
--> statement-breakpoint
CREATE TABLE "app"."agent_template_version" (
	"id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"content" varchar(20000) NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_agent_template_version_id" PRIMARY KEY("id"),
	CONSTRAINT "uk_agent_template_version_template_version" UNIQUE("template_id","version"),
	CONSTRAINT "ck_agent_template_version_positive" CHECK ("app"."agent_template_version"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "app"."project_template_selection" (
	"id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"selected_by_user_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_project_template_selection_id" PRIMARY KEY("id"),
	CONSTRAINT "uk_project_template_selection_project" UNIQUE("project_id")
);
--> statement-breakpoint
CREATE TABLE "app"."skill" (
	"id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"name" varchar(30) NOT NULL,
	"identifier" varchar(40) NOT NULL,
	"category" varchar(16) NOT NULL,
	"summary" varchar(100) NOT NULL,
	"source" varchar(16) DEFAULT 'team' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"current_version_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_skill_id" PRIMARY KEY("id"),
	CONSTRAINT "uk_skill_team_identifier" UNIQUE("team_id","identifier"),
	CONSTRAINT "ck_skill_category" CHECK ("app"."skill"."category" in ('product', 'engineering', 'delivery')),
	CONSTRAINT "ck_skill_source" CHECK ("app"."skill"."source" in ('team')),
	CONSTRAINT "ck_skill_identifier_format" CHECK ("app"."skill"."identifier" ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);
--> statement-breakpoint
CREATE TABLE "app"."skill_version" (
	"id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"skill_id" uuid NOT NULL,
	"content_version" varchar(20) NOT NULL,
	"content" varchar(6000) NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_skill_version_id" PRIMARY KEY("id"),
	CONSTRAINT "uk_skill_version_skill_content_version" UNIQUE("skill_id","content_version"),
	CONSTRAINT "ck_skill_version_format" CHECK ("app"."skill_version"."content_version" ~ '^[0-9]+\.[0-9]+\.[0-9]+$')
);
--> statement-breakpoint
CREATE TABLE "app"."template_snapshot_link" (
	"id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"template_version_id" uuid NOT NULL,
	"token" varchar(64) NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_template_snapshot_link_id" PRIMARY KEY("id"),
	CONSTRAINT "uk_template_snapshot_link_token" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "app"."activity" DROP CONSTRAINT "ck_activity_entity_type";--> statement-breakpoint
CREATE INDEX "idx_agent_template_team_updated" ON "app"."agent_template" USING btree ("team_id","updated_at","id");--> statement-breakpoint
CREATE INDEX "idx_agent_template_team_tag" ON "app"."agent_template" USING btree ("team_id","tag");--> statement-breakpoint
CREATE INDEX "idx_agent_template_version_template_version" ON "app"."agent_template_version" USING btree ("template_id","version");--> statement-breakpoint
CREATE INDEX "idx_project_template_selection_team" ON "app"."project_template_selection" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "idx_project_template_selection_template" ON "app"."project_template_selection" USING btree ("template_id");--> statement-breakpoint
CREATE INDEX "idx_skill_team_updated" ON "app"."skill" USING btree ("team_id","updated_at","id");--> statement-breakpoint
CREATE INDEX "idx_skill_team_category" ON "app"."skill" USING btree ("team_id","category");--> statement-breakpoint
CREATE INDEX "idx_skill_version_skill_created" ON "app"."skill_version" USING btree ("skill_id","created_at","id");--> statement-breakpoint
CREATE INDEX "idx_template_snapshot_link_template" ON "app"."template_snapshot_link" USING btree ("template_id","created_at","id");--> statement-breakpoint
ALTER TABLE "app"."activity" ADD CONSTRAINT "ck_activity_entity_type" CHECK ("app"."activity"."entity_type" in ('project', 'requirement', 'bug', 'code_reference', 'team_member', 'skill', 'agent_template'));

COMMENT ON TABLE "app"."agent_template" IS 'AGENTS.md 模板当前元数据';
COMMENT ON COLUMN "app"."agent_template"."id" IS '模板主键（UUID）';
COMMENT ON COLUMN "app"."agent_template"."team_id" IS '所属团队标识';
COMMENT ON COLUMN "app"."agent_template"."name" IS '模板名称';
COMMENT ON COLUMN "app"."agent_template"."name_normalized" IS '规范化名称（去首尾空白并转小写），团队内唯一';
COMMENT ON COLUMN "app"."agent_template"."tag" IS '分类标签';
COMMENT ON COLUMN "app"."agent_template"."description" IS '模板说明';
COMMENT ON COLUMN "app"."agent_template"."current_version_id" IS '当前正文版本标识';
COMMENT ON COLUMN "app"."agent_template"."version" IS '乐观锁版本号（并发控制）';
COMMENT ON COLUMN "app"."agent_template"."created_by_user_id" IS '创建者用户标识';
COMMENT ON COLUMN "app"."agent_template"."created_at" IS '创建时间';
COMMENT ON COLUMN "app"."agent_template"."updated_at" IS '更新时间';

COMMENT ON TABLE "app"."agent_template_version" IS 'AGENTS.md 模板正文历史版本';
COMMENT ON COLUMN "app"."agent_template_version"."id" IS '版本主键（UUID）';
COMMENT ON COLUMN "app"."agent_template_version"."team_id" IS '所属团队标识';
COMMENT ON COLUMN "app"."agent_template_version"."template_id" IS '模板标识';
COMMENT ON COLUMN "app"."agent_template_version"."version" IS '内容版本号（整数，按保存递增）';
COMMENT ON COLUMN "app"."agent_template_version"."content" IS 'AGENTS.md 正文快照';
COMMENT ON COLUMN "app"."agent_template_version"."created_by_user_id" IS '写入者用户标识';
COMMENT ON COLUMN "app"."agent_template_version"."created_at" IS '创建时间';
COMMENT ON COLUMN "app"."agent_template_version"."updated_at" IS '更新时间';

COMMENT ON TABLE "app"."project_template_selection" IS '项目当前选用的 AGENTS.md 模板';
COMMENT ON COLUMN "app"."project_template_selection"."id" IS '选用关系主键（UUID）';
COMMENT ON COLUMN "app"."project_template_selection"."team_id" IS '项目所属团队标识';
COMMENT ON COLUMN "app"."project_template_selection"."project_id" IS '项目标识';
COMMENT ON COLUMN "app"."project_template_selection"."template_id" IS '当前选用模板标识';
COMMENT ON COLUMN "app"."project_template_selection"."selected_by_user_id" IS '最近选用操作者标识';
COMMENT ON COLUMN "app"."project_template_selection"."version" IS '乐观锁版本号';
COMMENT ON COLUMN "app"."project_template_selection"."created_at" IS '创建时间';
COMMENT ON COLUMN "app"."project_template_selection"."updated_at" IS '更新时间';

COMMENT ON TABLE "app"."skill" IS '团队技能当前元数据';
COMMENT ON COLUMN "app"."skill"."id" IS '技能主键（UUID）';
COMMENT ON COLUMN "app"."skill"."team_id" IS '所属团队标识';
COMMENT ON COLUMN "app"."skill"."name" IS '技能名称';
COMMENT ON COLUMN "app"."skill"."identifier" IS '调用标识（小写字母、数字、连字符，发布后不可修改）';
COMMENT ON COLUMN "app"."skill"."category" IS '技能分类：product、engineering、delivery';
COMMENT ON COLUMN "app"."skill"."summary" IS '一句话简述';
COMMENT ON COLUMN "app"."skill"."source" IS '技能来源：team（团队维护）';
COMMENT ON COLUMN "app"."skill"."enabled" IS '是否启用';
COMMENT ON COLUMN "app"."skill"."current_version_id" IS '当前内容版本标识';
COMMENT ON COLUMN "app"."skill"."version" IS '乐观锁版本号（并发控制）';
COMMENT ON COLUMN "app"."skill"."created_by_user_id" IS '创建者用户标识';
COMMENT ON COLUMN "app"."skill"."created_at" IS '创建时间';
COMMENT ON COLUMN "app"."skill"."updated_at" IS '更新时间';

COMMENT ON TABLE "app"."skill_version" IS '团队技能内容历史版本';
COMMENT ON COLUMN "app"."skill_version"."id" IS '版本主键（UUID）';
COMMENT ON COLUMN "app"."skill_version"."team_id" IS '所属团队标识';
COMMENT ON COLUMN "app"."skill_version"."skill_id" IS '技能标识';
COMMENT ON COLUMN "app"."skill_version"."content_version" IS '成员维护的三段式内容版本';
COMMENT ON COLUMN "app"."skill_version"."content" IS 'SKILL.md 指令正文快照';
COMMENT ON COLUMN "app"."skill_version"."created_by_user_id" IS '写入者用户标识';
COMMENT ON COLUMN "app"."skill_version"."created_at" IS '创建时间';
COMMENT ON COLUMN "app"."skill_version"."updated_at" IS '更新时间';

COMMENT ON TABLE "app"."template_snapshot_link" IS 'AGENTS.md 模板快照预览链接';
COMMENT ON COLUMN "app"."template_snapshot_link"."id" IS '链接主键（UUID）';
COMMENT ON COLUMN "app"."template_snapshot_link"."team_id" IS '模板所属团队标识';
COMMENT ON COLUMN "app"."template_snapshot_link"."template_id" IS '模板标识';
COMMENT ON COLUMN "app"."template_snapshot_link"."template_version_id" IS '链接固定的模板正文版本标识';
COMMENT ON COLUMN "app"."template_snapshot_link"."token" IS '快照定位令牌（定位符，非凭证）';
COMMENT ON COLUMN "app"."template_snapshot_link"."created_by_user_id" IS '生成者用户标识';
COMMENT ON COLUMN "app"."template_snapshot_link"."created_at" IS '创建时间';
COMMENT ON COLUMN "app"."template_snapshot_link"."updated_at" IS '更新时间';
