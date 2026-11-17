ALTER TABLE "app"."project" ADD COLUMN "work_item_templates" jsonb DEFAULT '{}'::jsonb NOT NULL;
--> statement-breakpoint
COMMENT ON COLUMN "app"."project"."work_item_templates" IS '项目默认需求与 Bug 流程模板，按事项类型保存有序节点，未设置的类型使用系统默认节点。';
