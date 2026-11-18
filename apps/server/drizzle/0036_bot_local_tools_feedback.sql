CREATE TABLE "app"."bot_message_feedback" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"rating" text NOT NULL,
	CONSTRAINT "pk_bot_message_feedback_id" PRIMARY KEY("id"),
	CONSTRAINT "uk_bot_message_feedback_message_user" UNIQUE("message_id","user_id"),
	CONSTRAINT "ck_bot_message_feedback_rating" CHECK ("app"."bot_message_feedback"."rating" in ('helpful', 'unhelpful'))
);
--> statement-breakpoint
ALTER TABLE "app"."bot" ADD COLUMN "access_mode" text DEFAULT 'sandbox' NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."bot" ADD CONSTRAINT "ck_bot_access_mode" CHECK ("app"."bot"."access_mode" in ('sandbox', 'full'));
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot"."access_mode" IS '本地工具访问范围：sandbox 为独立工作目录沙盒，full 为执行主机完全访问';
--> statement-breakpoint
COMMENT ON TABLE "app"."bot_message_feedback" IS '会话成员对 Bot 回复的当前评价';
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_message_feedback"."id" IS '评价标识';
COMMENT ON COLUMN "app"."bot_message_feedback"."team_id" IS '所属团队标识';
COMMENT ON COLUMN "app"."bot_message_feedback"."created_at" IS '创建时间';
COMMENT ON COLUMN "app"."bot_message_feedback"."updated_at" IS '最后更新时间';
COMMENT ON COLUMN "app"."bot_message_feedback"."conversation_id" IS '来源会话标识';
COMMENT ON COLUMN "app"."bot_message_feedback"."message_id" IS '被评价的 Bot 回复标识';
COMMENT ON COLUMN "app"."bot_message_feedback"."user_id" IS '评价成员标识';
COMMENT ON COLUMN "app"."bot_message_feedback"."rating" IS '评价：helpful 有帮助，unhelpful 无帮助';
