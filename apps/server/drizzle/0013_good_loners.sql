CREATE TABLE "app"."personal_access_token" (
	"id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"token_prefix" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_personal_access_token_id" PRIMARY KEY("id"),
	CONSTRAINT "uk_personal_access_token_hash" UNIQUE("token_hash"),
	CONSTRAINT "uk_personal_access_token_user_name" UNIQUE("user_id","name")
);
--> statement-breakpoint
CREATE INDEX "idx_personal_access_token_user_id" ON "app"."personal_access_token" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_personal_access_token_expires_at" ON "app"."personal_access_token" USING btree ("expires_at");
--> statement-breakpoint
COMMENT ON TABLE "app"."personal_access_token" IS '个人 API Token；仅保存摘要，供 CLI/自动化使用';
--> statement-breakpoint
COMMENT ON COLUMN "app"."personal_access_token"."id" IS 'Token 记录主键（UUID）';
--> statement-breakpoint
COMMENT ON COLUMN "app"."personal_access_token"."user_id" IS '所属用户标识';
--> statement-breakpoint
COMMENT ON COLUMN "app"."personal_access_token"."name" IS '用户可读名称，同账号唯一';
--> statement-breakpoint
COMMENT ON COLUMN "app"."personal_access_token"."token_hash" IS 'Token 的 SHA-256 摘要，不保存明文';
--> statement-breakpoint
COMMENT ON COLUMN "app"."personal_access_token"."token_prefix" IS '展示用前缀，不用于鉴权';
--> statement-breakpoint
COMMENT ON COLUMN "app"."personal_access_token"."expires_at" IS 'Token 到期时间';
--> statement-breakpoint
COMMENT ON COLUMN "app"."personal_access_token"."revoked_at" IS '撤销时间，空表示未撤销';
--> statement-breakpoint
COMMENT ON COLUMN "app"."personal_access_token"."last_used_at" IS '最近成功鉴权时间';
--> statement-breakpoint
COMMENT ON COLUMN "app"."personal_access_token"."created_at" IS '创建时间';
--> statement-breakpoint
COMMENT ON COLUMN "app"."personal_access_token"."updated_at" IS '更新时间';
