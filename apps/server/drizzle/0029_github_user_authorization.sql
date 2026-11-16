CREATE TABLE "app"."github_user_authorization" (
	"id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"github_user_id" text NOT NULL,
	"login" text NOT NULL,
	"ciphertext" text NOT NULL,
	"iv" text NOT NULL,
	"auth_tag" text NOT NULL,
	"key_version" integer NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_github_user_authorization_id" PRIMARY KEY("id"),
	CONSTRAINT "uk_github_user_authorization_user" UNIQUE("user_id"),
	CONSTRAINT "uk_github_user_authorization_github_user" UNIQUE("github_user_id")
);
--> statement-breakpoint
COMMENT ON TABLE app.github_user_authorization IS '平台用户与 GitHub 账号的绑定及加密用户授权，独立于团队安装';
COMMENT ON COLUMN app.github_user_authorization.id IS '绑定主键';
COMMENT ON COLUMN app.github_user_authorization.user_id IS '平台用户主键，每个用户最多绑定一个 GitHub 账号';
COMMENT ON COLUMN app.github_user_authorization.github_user_id IS 'GitHub 稳定用户 ID，同一 GitHub 账号只能绑定一次';
COMMENT ON COLUMN app.github_user_authorization.login IS '最近一次授权时的 GitHub 公开用户名';
COMMENT ON COLUMN app.github_user_authorization.ciphertext IS '用户访问令牌与可选刷新令牌的加密载荷';
COMMENT ON COLUMN app.github_user_authorization.iv IS 'AES-GCM 初始化向量，Base64 编码';
COMMENT ON COLUMN app.github_user_authorization.auth_tag IS 'AES-GCM 认证标签，Base64 编码';
COMMENT ON COLUMN app.github_user_authorization.key_version IS '加密密钥版本';
COMMENT ON COLUMN app.github_user_authorization.expires_at IS '当前访问令牌到期时间，空值表示 GitHub 未提供到期时间';
COMMENT ON COLUMN app.github_user_authorization.created_at IS '首次绑定时间';
COMMENT ON COLUMN app.github_user_authorization.updated_at IS '最近绑定或令牌刷新时间';
