ALTER TABLE "app"."bug" ADD COLUMN "work_plan" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."requirement" ADD COLUMN "work_plan" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
COMMENT ON COLUMN "app"."bug"."work_plan" IS '缺陷规划节点与待办，起止日期可为空，日期以自然日计';--> statement-breakpoint
COMMENT ON COLUMN "app"."requirement"."work_plan" IS '需求规划节点与待办，起止日期可为空，日期以自然日计';
