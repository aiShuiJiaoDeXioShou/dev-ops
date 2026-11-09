CREATE TABLE "app"."account" (
	"id" uuid NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_account_id" PRIMARY KEY("id"),
	CONSTRAINT "uk_account_provider_account" UNIQUE("provider_id","account_id")
);
--> statement-breakpoint
CREATE TABLE "app"."session" (
	"id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" uuid NOT NULL,
	CONSTRAINT "pk_session_id" PRIMARY KEY("id"),
	CONSTRAINT "uk_session_token" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "app"."user" (
	"id" uuid NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_user_id" PRIMARY KEY("id"),
	CONSTRAINT "uk_user_email" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "app"."verification" (
	"id" uuid NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_verification_id" PRIMARY KEY("id")
);
--> statement-breakpoint
CREATE TABLE "app"."platform_admin" (
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_platform_admin_user_id" PRIMARY KEY("user_id")
);
--> statement-breakpoint
CREATE INDEX "idx_account_user_id" ON "app"."account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_session_user_id" ON "app"."session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_verification_identifier" ON "app"."verification" USING btree ("identifier");
COMMENT ON TABLE "app"."user" IS 'Better Auth 用户账号';
COMMENT ON COLUMN "app"."user"."id" IS '用户主键（UUID）';
COMMENT ON COLUMN "app"."user"."name" IS '展示用户名';
COMMENT ON COLUMN "app"."user"."email" IS '登录邮箱，唯一';
COMMENT ON COLUMN "app"."user"."email_verified" IS '邮箱是否已验证';
COMMENT ON COLUMN "app"."user"."image" IS '头像地址';
COMMENT ON COLUMN "app"."user"."created_at" IS '创建时间';
COMMENT ON COLUMN "app"."user"."updated_at" IS '更新时间';

COMMENT ON TABLE "app"."session" IS 'Better Auth 数据库会话';
COMMENT ON COLUMN "app"."session"."id" IS '会话主键（UUID）';
COMMENT ON COLUMN "app"."session"."expires_at" IS '会话过期时间';
COMMENT ON COLUMN "app"."session"."token" IS '会话令牌，唯一';
COMMENT ON COLUMN "app"."session"."created_at" IS '创建时间';
COMMENT ON COLUMN "app"."session"."updated_at" IS '更新时间';
COMMENT ON COLUMN "app"."session"."ip_address" IS '登录来源 IP';
COMMENT ON COLUMN "app"."session"."user_agent" IS '登录客户端标识';
COMMENT ON COLUMN "app"."session"."user_id" IS '所属用户标识';

COMMENT ON TABLE "app"."account" IS 'Better Auth 账号凭据';
COMMENT ON COLUMN "app"."account"."id" IS '凭据主键（UUID）';
COMMENT ON COLUMN "app"."account"."account_id" IS '来源账号标识；邮箱密码为归一化邮箱';
COMMENT ON COLUMN "app"."account"."provider_id" IS '认证方式标识；邮箱密码为 credential';
COMMENT ON COLUMN "app"."account"."user_id" IS '所属用户标识';
COMMENT ON COLUMN "app"."account"."access_token" IS '可选来源访问令牌';
COMMENT ON COLUMN "app"."account"."refresh_token" IS '可选来源刷新令牌';
COMMENT ON COLUMN "app"."account"."id_token" IS '可选 OIDC 身份令牌';
COMMENT ON COLUMN "app"."account"."access_token_expires_at" IS '访问令牌过期时间';
COMMENT ON COLUMN "app"."account"."refresh_token_expires_at" IS '刷新令牌过期时间';
COMMENT ON COLUMN "app"."account"."scope" IS '来源授权范围';
COMMENT ON COLUMN "app"."account"."password" IS '密码哈希，仅认证库读写';
COMMENT ON COLUMN "app"."account"."created_at" IS '创建时间';
COMMENT ON COLUMN "app"."account"."updated_at" IS '更新时间';

COMMENT ON TABLE "app"."verification" IS 'Better Auth 一次性验证令牌';
COMMENT ON COLUMN "app"."verification"."id" IS '令牌主键（UUID）';
COMMENT ON COLUMN "app"."verification"."identifier" IS '令牌用途或身份标识';
COMMENT ON COLUMN "app"."verification"."value" IS '令牌值';
COMMENT ON COLUMN "app"."verification"."expires_at" IS '过期时间';
COMMENT ON COLUMN "app"."verification"."created_at" IS '创建时间';
COMMENT ON COLUMN "app"."verification"."updated_at" IS '更新时间';

COMMENT ON TABLE "app"."platform_admin" IS '平台级 root 管理员账号';
COMMENT ON COLUMN "app"."platform_admin"."user_id" IS 'root 用户标识';
COMMENT ON COLUMN "app"."platform_admin"."created_at" IS '创建时间';
COMMENT ON COLUMN "app"."platform_admin"."updated_at" IS '更新时间';
