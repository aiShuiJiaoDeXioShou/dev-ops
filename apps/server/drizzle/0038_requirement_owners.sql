CREATE TABLE "app"."requirement_owner" (
	"id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"requirement_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_requirement_owner_id" PRIMARY KEY("id"),
	CONSTRAINT "uk_requirement_owner_role_user" UNIQUE("requirement_id","role","user_id"),
	CONSTRAINT "ck_requirement_owner_role" CHECK ("app"."requirement_owner"."role" in ('development', 'test'))
);
--> statement-breakpoint
CREATE INDEX "idx_requirement_owner_user" ON "app"."requirement_owner" USING btree ("team_id","user_id");--> statement-breakpoint
COMMENT ON TABLE app.requirement_owner IS '需求研发与测试负责人关联，兼容旧单负责人字段';
COMMENT ON COLUMN app.requirement_owner.id IS '关联记录标识';
COMMENT ON COLUMN app.requirement_owner.team_id IS '所属团队标识';
COMMENT ON COLUMN app.requirement_owner.requirement_id IS '所属需求标识';
COMMENT ON COLUMN app.requirement_owner.user_id IS '负责人用户标识';
COMMENT ON COLUMN app.requirement_owner.role IS '负责人角色：development 研发，test 测试';
COMMENT ON COLUMN app.requirement_owner.created_at IS '创建时间';
COMMENT ON COLUMN app.requirement_owner.updated_at IS '更新时间';
INSERT INTO app.requirement_owner (id, team_id, requirement_id, user_id, role)
SELECT gen_random_uuid(), team_id, id, dev_owner_user_id, 'development' FROM app.requirement WHERE dev_owner_user_id IS NOT NULL;
INSERT INTO app.requirement_owner (id, team_id, requirement_id, user_id, role)
SELECT gen_random_uuid(), team_id, id, test_owner_user_id, 'test' FROM app.requirement WHERE test_owner_user_id IS NOT NULL;
