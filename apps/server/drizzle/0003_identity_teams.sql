CREATE TABLE "app"."invitation" (
	"id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" text NOT NULL,
	"token_hash" text NOT NULL,
	"status" text NOT NULL,
	"invited_by_user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"delivery_status" text DEFAULT 'pending' NOT NULL,
	"send_attempts" integer DEFAULT 0 NOT NULL,
	"last_sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_invitation_id" PRIMARY KEY("id"),
	CONSTRAINT "uk_invitation_token_hash" UNIQUE("token_hash"),
	CONSTRAINT "ck_invitation_role" CHECK ("app"."invitation"."role" in ('admin', 'developer', 'viewer')),
	CONSTRAINT "ck_invitation_status" CHECK ("app"."invitation"."status" in ('pending', 'accepted', 'expired', 'revoked')),
	CONSTRAINT "ck_invitation_delivery_status" CHECK ("app"."invitation"."delivery_status" in ('pending', 'sent', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "app"."team" (
	"id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_team_id" PRIMARY KEY("id"),
	CONSTRAINT "uk_team_name" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "app"."team_member" (
	"id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"status" text NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_team_member_id" PRIMARY KEY("id"),
	CONSTRAINT "uk_team_member" UNIQUE("team_id","user_id"),
	CONSTRAINT "ck_team_member_role" CHECK ("app"."team_member"."role" in ('admin', 'developer', 'viewer')),
	CONSTRAINT "ck_team_member_status" CHECK ("app"."team_member"."status" in ('active', 'disabled'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "uk_invitation_pending_email" ON "app"."invitation" USING btree ("team_id","email") WHERE "app"."invitation"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "idx_invitation_team_status" ON "app"."invitation" USING btree ("team_id","status");--> statement-breakpoint
CREATE INDEX "idx_invitation_expires_at" ON "app"."invitation" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_team_member_user_id" ON "app"."team_member" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_team_member_team_status" ON "app"."team_member" USING btree ("team_id","status");
COMMENT ON TABLE "app"."team" IS '内部团队';
COMMENT ON COLUMN "app"."team"."id" IS '团队主键（UUID）';
COMMENT ON COLUMN "app"."team"."name" IS '团队名称，全局唯一';
COMMENT ON COLUMN "app"."team"."created_by_user_id" IS '创建者用户标识';
COMMENT ON COLUMN "app"."team"."created_at" IS '创建时间';
COMMENT ON COLUMN "app"."team"."updated_at" IS '更新时间';

COMMENT ON TABLE "app"."team_member" IS '团队成员与团队角色';
COMMENT ON COLUMN "app"."team_member"."id" IS '成员关系主键（UUID）';
COMMENT ON COLUMN "app"."team_member"."team_id" IS '所属团队标识';
COMMENT ON COLUMN "app"."team_member"."user_id" IS '用户标识';
COMMENT ON COLUMN "app"."team_member"."role" IS '团队角色：admin、developer、viewer';
COMMENT ON COLUMN "app"."team_member"."status" IS '成员状态：active、disabled';
COMMENT ON COLUMN "app"."team_member"."joined_at" IS '加入时间';
COMMENT ON COLUMN "app"."team_member"."created_at" IS '创建时间';
COMMENT ON COLUMN "app"."team_member"."updated_at" IS '更新时间';

COMMENT ON TABLE "app"."invitation" IS '团队邮箱邀请';
COMMENT ON COLUMN "app"."invitation"."id" IS '邀请主键（UUID）';
COMMENT ON COLUMN "app"."invitation"."team_id" IS '目标团队标识';
COMMENT ON COLUMN "app"."invitation"."email" IS '受邀邮箱，保存小写';
COMMENT ON COLUMN "app"."invitation"."role" IS '邀请加入的团队角色';
COMMENT ON COLUMN "app"."invitation"."token_hash" IS '邀请 token 的 SHA-256 哈希';
COMMENT ON COLUMN "app"."invitation"."status" IS '邀请状态：pending、accepted、expired、revoked';
COMMENT ON COLUMN "app"."invitation"."invited_by_user_id" IS '发起邀请的用户标识';
COMMENT ON COLUMN "app"."invitation"."expires_at" IS '邀请过期时间';
COMMENT ON COLUMN "app"."invitation"."accepted_at" IS '接受时间';
COMMENT ON COLUMN "app"."invitation"."revoked_at" IS '撤销时间';
COMMENT ON COLUMN "app"."invitation"."delivery_status" IS '邮件投递状态：pending、sent、failed';
COMMENT ON COLUMN "app"."invitation"."send_attempts" IS '发送尝试次数';
COMMENT ON COLUMN "app"."invitation"."last_sent_at" IS '最近发送时间';
COMMENT ON COLUMN "app"."invitation"."created_at" IS '创建时间';
COMMENT ON COLUMN "app"."invitation"."updated_at" IS '更新时间';
