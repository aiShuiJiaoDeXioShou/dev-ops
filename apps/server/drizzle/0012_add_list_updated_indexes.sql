-- 列表查询在未按状态过滤时按 updated_at、id 倒序分页；既有联合索引以 status 作为中间列，
-- 无法直接提供排序，补充不含 status 的排序索引，避免扫描后全量排序。
CREATE INDEX "idx_bug_project_updated" ON "app"."bug" USING btree ("project_id","updated_at","id");--> statement-breakpoint
CREATE INDEX "idx_project_team_updated" ON "app"."project" USING btree ("team_id","updated_at","id");--> statement-breakpoint
CREATE INDEX "idx_requirement_project_updated" ON "app"."requirement" USING btree ("project_id","updated_at","id");
