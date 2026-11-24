ALTER TABLE "app"."bot_conversation" ADD COLUMN "todos" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_conversation"."todos" IS '模型维护的本次工作待办清单，状态为 pending、in_progress 或 completed';
--> statement-breakpoint
ALTER TABLE "app"."bot_conversation" ADD COLUMN "reply_requested_run_id" uuid;
--> statement-breakpoint
COMMENT ON COLUMN "app"."bot_conversation"."reply_requested_run_id" IS '最后一次明确请求成员回复的运行；后续新运行自动取代该等待状态';
--> statement-breakpoint
-- 旧任务停止接受调度，运行中的工具通过现有停止检查退出；保留历史任务和运行记录。
UPDATE "app"."bot_run"
SET "status" = 'stopped', "finished_at" = clock_timestamp(), "updated_at" = clock_timestamp(),
    "failure_kind" = NULL, "failure_message" = NULL
WHERE "task_id" IS NOT NULL AND "status" = 'queued';
--> statement-breakpoint
UPDATE "app"."bot_run"
SET "stop_requested" = true, "updated_at" = clock_timestamp()
WHERE "task_id" IS NOT NULL AND "status" = 'running' AND NOT "stop_requested";
