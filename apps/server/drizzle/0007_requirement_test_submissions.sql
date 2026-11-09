CREATE TABLE "app"."requirement_test_submission" (
	"id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"requirement_id" uuid NOT NULL,
	"submitted_by_user_id" uuid NOT NULL,
	"dev_owner_user_id" uuid NOT NULL,
	"test_owner_user_id" uuid NOT NULL,
	"scope_note" text NOT NULL,
	"self_test_result" text NOT NULL,
	"self_test_note" text,
	"test_entry" text,
	"version_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_requirement_test_submission_id" PRIMARY KEY("id"),
	CONSTRAINT "ck_requirement_test_submission_result" CHECK ("app"."requirement_test_submission"."self_test_result" in ('passed', 'has_failures', 'not_run', 'not_applicable')),
	CONSTRAINT "ck_requirement_test_submission_note" CHECK ("app"."requirement_test_submission"."self_test_result" = 'passed' OR ("app"."requirement_test_submission"."self_test_note" IS NOT NULL AND length(btrim("app"."requirement_test_submission"."self_test_note")) > 0))
);
--> statement-breakpoint
CREATE INDEX "idx_requirement_test_submission_requirement" ON "app"."requirement_test_submission" USING btree ("requirement_id","created_at");
COMMENT ON TABLE "app"."requirement_test_submission" IS '需求提测记录';
COMMENT ON COLUMN "app"."requirement_test_submission"."id" IS '提测记录主键（UUID）';
COMMENT ON COLUMN "app"."requirement_test_submission"."team_id" IS '所属团队标识';
COMMENT ON COLUMN "app"."requirement_test_submission"."requirement_id" IS '需求标识';
COMMENT ON COLUMN "app"."requirement_test_submission"."submitted_by_user_id" IS '提测操作者标识';
COMMENT ON COLUMN "app"."requirement_test_submission"."dev_owner_user_id" IS '提测时研发负责人标识';
COMMENT ON COLUMN "app"."requirement_test_submission"."test_owner_user_id" IS '提测时测试负责人标识';
COMMENT ON COLUMN "app"."requirement_test_submission"."scope_note" IS '测试范围说明';
COMMENT ON COLUMN "app"."requirement_test_submission"."self_test_result" IS '自测结论：passed、has_failures、not_run、not_applicable';
COMMENT ON COLUMN "app"."requirement_test_submission"."self_test_note" IS '自测说明，非 passed 时必填';
COMMENT ON COLUMN "app"."requirement_test_submission"."test_entry" IS '测试入口';
COMMENT ON COLUMN "app"."requirement_test_submission"."version_note" IS '版本说明';
COMMENT ON COLUMN "app"."requirement_test_submission"."created_at" IS '创建时间';
COMMENT ON COLUMN "app"."requirement_test_submission"."updated_at" IS '更新时间';
