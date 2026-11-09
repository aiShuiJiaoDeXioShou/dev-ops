CREATE TABLE "app"."bug" (
	"id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"title" text NOT NULL,
	"phenomenon" text NOT NULL,
	"expected_behavior" text NOT NULL,
	"reproduction" text,
	"reproduction_unknown" boolean DEFAULT false NOT NULL,
	"evidence_text" text,
	"evidence_url" text,
	"fix_owner_user_id" uuid,
	"regression_owner_user_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_bug_id" PRIMARY KEY("id"),
	CONSTRAINT "uk_bug_project_number" UNIQUE("project_id","number"),
	CONSTRAINT "ck_bug_status" CHECK ("app"."bug"."status" in ('pending', 'in_fix', 'in_regression', 'resolved', 'closed')),
	CONSTRAINT "ck_bug_reproduction" CHECK (("app"."bug"."reproduction_unknown" = true) OR ("app"."bug"."reproduction" IS NOT NULL AND length(btrim("app"."bug"."reproduction")) > 0))
);
--> statement-breakpoint
CREATE TABLE "app"."bug_regression" (
	"id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"bug_id" uuid NOT NULL,
	"attempt" integer NOT NULL,
	"fix_summary" text NOT NULL,
	"fixer_user_id" uuid NOT NULL,
	"verifier_user_id" uuid NOT NULL,
	"result" text DEFAULT 'pending' NOT NULL,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"verified_at" timestamp with time zone,
	CONSTRAINT "pk_bug_regression_id" PRIMARY KEY("id"),
	CONSTRAINT "uk_bug_regression_attempt" UNIQUE("bug_id","attempt"),
	CONSTRAINT "ck_bug_regression_result" CHECK ("app"."bug_regression"."result" in ('pending', 'passed', 'failed', 'withdrawn'))
);
--> statement-breakpoint
CREATE TABLE "app"."bug_requirement_link" (
	"id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"bug_id" uuid NOT NULL,
	"requirement_id" uuid NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_bug_requirement_link_id" PRIMARY KEY("id"),
	CONSTRAINT "uk_bug_requirement_link" UNIQUE("bug_id","requirement_id")
);
--> statement-breakpoint
CREATE INDEX "idx_bug_project_status" ON "app"."bug" USING btree ("project_id","status","updated_at","id");--> statement-breakpoint
CREATE INDEX "idx_bug_project_owner" ON "app"."bug" USING btree ("project_id","fix_owner_user_id");--> statement-breakpoint
CREATE INDEX "idx_bug_team" ON "app"."bug" USING btree ("team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uk_bug_regression_pending" ON "app"."bug_regression" USING btree ("bug_id") WHERE "app"."bug_regression"."result" = 'pending';--> statement-breakpoint
CREATE INDEX "idx_bug_regression_bug" ON "app"."bug_regression" USING btree ("bug_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_bug_requirement_link_requirement" ON "app"."bug_requirement_link" USING btree ("requirement_id");
COMMENT ON TABLE "app"."bug" IS '项目内部 Bug';
COMMENT ON COLUMN "app"."bug"."id" IS 'Bug 主键（UUID）';
COMMENT ON COLUMN "app"."bug"."team_id" IS '所属团队标识';
COMMENT ON COLUMN "app"."bug"."project_id" IS '所属项目标识';
COMMENT ON COLUMN "app"."bug"."number" IS '项目内稳定编号';
COMMENT ON COLUMN "app"."bug"."title" IS 'Bug 标题';
COMMENT ON COLUMN "app"."bug"."phenomenon" IS '现象描述';
COMMENT ON COLUMN "app"."bug"."expected_behavior" IS '预期行为';
COMMENT ON COLUMN "app"."bug"."reproduction" IS '复现步骤';
COMMENT ON COLUMN "app"."bug"."reproduction_unknown" IS '是否明确无法稳定复现';
COMMENT ON COLUMN "app"."bug"."evidence_text" IS '证据文本';
COMMENT ON COLUMN "app"."bug"."evidence_url" IS '证据外链';
COMMENT ON COLUMN "app"."bug"."fix_owner_user_id" IS '修复负责人标识';
COMMENT ON COLUMN "app"."bug"."regression_owner_user_id" IS '回归负责人标识';
COMMENT ON COLUMN "app"."bug"."status" IS '状态：pending、in_fix、in_regression、resolved、closed';
COMMENT ON COLUMN "app"."bug"."version" IS '乐观锁版本号';
COMMENT ON COLUMN "app"."bug"."created_by_user_id" IS '创建者用户标识';
COMMENT ON COLUMN "app"."bug"."created_at" IS '创建时间';
COMMENT ON COLUMN "app"."bug"."updated_at" IS '更新时间';

COMMENT ON TABLE "app"."bug_requirement_link" IS 'Bug 与需求的关联';
COMMENT ON COLUMN "app"."bug_requirement_link"."id" IS '关联主键（UUID）';
COMMENT ON COLUMN "app"."bug_requirement_link"."team_id" IS '所属团队标识';
COMMENT ON COLUMN "app"."bug_requirement_link"."bug_id" IS 'Bug 标识';
COMMENT ON COLUMN "app"."bug_requirement_link"."requirement_id" IS '需求标识';
COMMENT ON COLUMN "app"."bug_requirement_link"."created_by_user_id" IS '关联创建者标识';
COMMENT ON COLUMN "app"."bug_requirement_link"."created_at" IS '创建时间';
COMMENT ON COLUMN "app"."bug_requirement_link"."updated_at" IS '更新时间';

COMMENT ON TABLE "app"."bug_regression" IS 'Bug 修复与回归记录';
COMMENT ON COLUMN "app"."bug_regression"."id" IS '回归记录主键（UUID）';
COMMENT ON COLUMN "app"."bug_regression"."team_id" IS '所属团队标识';
COMMENT ON COLUMN "app"."bug_regression"."bug_id" IS 'Bug 标识';
COMMENT ON COLUMN "app"."bug_regression"."attempt" IS '回归轮次';
COMMENT ON COLUMN "app"."bug_regression"."fix_summary" IS '修复说明';
COMMENT ON COLUMN "app"."bug_regression"."fixer_user_id" IS '修复提交人标识';
COMMENT ON COLUMN "app"."bug_regression"."verifier_user_id" IS '回归负责人标识';
COMMENT ON COLUMN "app"."bug_regression"."result" IS '回归结果：pending、passed、failed、withdrawn';
COMMENT ON COLUMN "app"."bug_regression"."failure_reason" IS '回归失败原因';
COMMENT ON COLUMN "app"."bug_regression"."created_at" IS '创建时间';
COMMENT ON COLUMN "app"."bug_regression"."updated_at" IS '更新时间';
COMMENT ON COLUMN "app"."bug_regression"."verified_at" IS '回归完成时间';
