CREATE TABLE "app"."activity" (
	"id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"project_id" uuid,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"action" text NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"changes" jsonb,
	"reason" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_activity_id" PRIMARY KEY("id"),
	CONSTRAINT "ck_activity_entity_type" CHECK ("app"."activity"."entity_type" in ('project', 'requirement', 'bug', 'code_reference', 'team_member'))
);
--> statement-breakpoint
CREATE TABLE "app"."comment" (
	"id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"project_id" uuid,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"author_user_id" uuid NOT NULL,
	"body_markdown" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_comment_id" PRIMARY KEY("id"),
	CONSTRAINT "ck_comment_entity_type" CHECK ("app"."comment"."entity_type" in ('project', 'requirement', 'bug'))
);
--> statement-breakpoint
CREATE INDEX "idx_activity_entity" ON "app"."activity" USING btree ("entity_type","entity_id","created_at","id");--> statement-breakpoint
CREATE INDEX "idx_activity_team" ON "app"."activity" USING btree ("team_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_comment_entity" ON "app"."comment" USING btree ("entity_type","entity_id","created_at","id");--> statement-breakpoint
CREATE INDEX "idx_comment_team" ON "app"."comment" USING btree ("team_id");
COMMENT ON TABLE "app"."comment" IS '事项评论，保存 Markdown 源文本';
COMMENT ON COLUMN "app"."comment"."id" IS '评论主键（UUID）';
COMMENT ON COLUMN "app"."comment"."team_id" IS '所属团队标识';
COMMENT ON COLUMN "app"."comment"."project_id" IS '可选所属项目标识';
COMMENT ON COLUMN "app"."comment"."entity_type" IS '评论目标类型：project、requirement、bug';
COMMENT ON COLUMN "app"."comment"."entity_id" IS '评论目标标识';
COMMENT ON COLUMN "app"."comment"."author_user_id" IS '评论作者标识';
COMMENT ON COLUMN "app"."comment"."body_markdown" IS '评论 Markdown 正文';
COMMENT ON COLUMN "app"."comment"."created_at" IS '创建时间';
COMMENT ON COLUMN "app"."comment"."updated_at" IS '更新时间';

COMMENT ON TABLE "app"."activity" IS '追加型业务活动记录';
COMMENT ON COLUMN "app"."activity"."id" IS '活动主键（UUID）';
COMMENT ON COLUMN "app"."activity"."team_id" IS '所属团队标识';
COMMENT ON COLUMN "app"."activity"."project_id" IS '可选所属项目标识';
COMMENT ON COLUMN "app"."activity"."entity_type" IS '活动目标类型';
COMMENT ON COLUMN "app"."activity"."entity_id" IS '活动目标标识';
COMMENT ON COLUMN "app"."activity"."action" IS '动作标识，如 status_changed、owner_changed';
COMMENT ON COLUMN "app"."activity"."actor_user_id" IS '实际操作者标识';
COMMENT ON COLUMN "app"."activity"."changes" IS '安全字段变更快照，不保存凭据或敏感正文';
COMMENT ON COLUMN "app"."activity"."reason" IS '动作要求的原因';
COMMENT ON COLUMN "app"."activity"."note" IS '动作说明或结论';
COMMENT ON COLUMN "app"."activity"."created_at" IS '创建时间';
COMMENT ON COLUMN "app"."activity"."updated_at" IS '更新时间';
