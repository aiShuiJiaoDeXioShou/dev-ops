CREATE TABLE "app"."secret" (
	"id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"ciphertext" text NOT NULL,
	"iv" text NOT NULL,
	"auth_tag" text NOT NULL,
	"key_version" smallint NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"expires_at" timestamp with time zone,
	"rotated_from_id" uuid,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_secret_id" PRIMARY KEY("id"),
	CONSTRAINT "ck_secret_kind" CHECK ("app"."secret"."kind" in ('git_token', 'github_app_private_key')),
	CONSTRAINT "ck_secret_status" CHECK ("app"."secret"."status" in ('active', 'revoked'))
);
--> statement-breakpoint
CREATE INDEX "idx_secret_team_kind" ON "app"."secret" USING btree ("team_id","kind","status");
COMMENT ON TABLE "app"."secret" IS '加密保存的 Git 凭据';
COMMENT ON COLUMN "app"."secret"."id" IS '凭据主键（UUID）';
COMMENT ON COLUMN "app"."secret"."team_id" IS '所属团队标识';
COMMENT ON COLUMN "app"."secret"."kind" IS '凭据类型：git_token、github_app_private_key';
COMMENT ON COLUMN "app"."secret"."name" IS '展示名称';
COMMENT ON COLUMN "app"."secret"."ciphertext" IS 'AES-256-GCM 密文（base64）';
COMMENT ON COLUMN "app"."secret"."iv" IS '初始化向量（base64）';
COMMENT ON COLUMN "app"."secret"."auth_tag" IS '认证标签（base64）';
COMMENT ON COLUMN "app"."secret"."key_version" IS '加密密钥版本';
COMMENT ON COLUMN "app"."secret"."status" IS '状态：active、revoked';
COMMENT ON COLUMN "app"."secret"."expires_at" IS '可选过期时间';
COMMENT ON COLUMN "app"."secret"."rotated_from_id" IS '轮换来源凭据标识';
COMMENT ON COLUMN "app"."secret"."created_by_user_id" IS '创建者用户标识';
COMMENT ON COLUMN "app"."secret"."created_at" IS '创建时间';
COMMENT ON COLUMN "app"."secret"."updated_at" IS '更新时间';
