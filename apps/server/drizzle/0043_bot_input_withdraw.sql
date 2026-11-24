ALTER TABLE app.bot_run_input DROP CONSTRAINT ck_bot_run_input_status;
--> statement-breakpoint
ALTER TABLE app.bot_run_input ADD CONSTRAINT ck_bot_run_input_status CHECK (status IN ('pending', 'delivering', 'delivered', 'requeued', 'withdrawn'));
--> statement-breakpoint
COMMENT ON COLUMN app.bot_run_input.status IS 'pending 可撤回待投递，delivering 已领取待写回，delivered 已投递，requeued 已重新入队，withdrawn 已撤回';
