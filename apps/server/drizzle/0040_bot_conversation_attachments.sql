ALTER TABLE "app"."attachment" DROP CONSTRAINT "ck_attachment_target";--> statement-breakpoint
ALTER TABLE "app"."attachment" ALTER COLUMN "project_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."attachment" ADD COLUMN "conversation_id" uuid;--> statement-breakpoint
ALTER TABLE "app"."attachment" ADD CONSTRAINT "ck_attachment_scope" CHECK (("app"."attachment"."project_id" IS NOT NULL) <> ("app"."attachment"."conversation_id" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "app"."attachment" ADD CONSTRAINT "ck_attachment_target" CHECK ((
    ("app"."attachment"."status" = 'temp' AND "app"."attachment"."target_type" IS NULL AND "app"."attachment"."target_id" IS NULL
      AND "app"."attachment"."bound_at" IS NULL)
    OR ("app"."attachment"."status" in ('bound', 'removed') AND (("app"."attachment"."project_id" IS NOT NULL AND "app"."attachment"."target_type" in ('requirement', 'bug'))
        OR ("app"."attachment"."conversation_id" IS NOT NULL AND "app"."attachment"."target_type" = 'bot_message'))
      AND "app"."attachment"."target_type" IS NOT NULL AND "app"."attachment"."target_id" IS NOT NULL AND "app"."attachment"."bound_at" IS NOT NULL)
  ));
--> statement-breakpoint
COMMENT ON TABLE "app"."attachment" IS '项目和会话的上传附件；文件内容存于储存桶';
--> statement-breakpoint
COMMENT ON COLUMN "app"."attachment"."project_id" IS '项目附件所属项目；会话附件为空';
--> statement-breakpoint
COMMENT ON COLUMN "app"."attachment"."conversation_id" IS '会话附件最初上传的会话；项目附件为空';
--> statement-breakpoint
COMMENT ON COLUMN "app"."attachment"."target_type" IS '绑定目标类型：requirement 需求、bug 缺陷、bot_message 会话消息；临时附件为空';
