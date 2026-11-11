CREATE TABLE "app"."attachment" (
	"id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"bucket_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"file_name" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"content_type" text,
	"sha256" text NOT NULL,
	"status" text DEFAULT 'temp' NOT NULL,
	"target_type" text,
	"target_id" uuid,
	"uploaded_by_user_id" uuid NOT NULL,
	"bound_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_attachment_id" PRIMARY KEY("id"),
	CONSTRAINT "uk_attachment_storage_key" UNIQUE("bucket_id","storage_key"),
	CONSTRAINT "ck_attachment_status" CHECK ("app"."attachment"."status" in ('temp', 'bound', 'removed')),
	CONSTRAINT "ck_attachment_size" CHECK ("app"."attachment"."size_bytes" > 0),
	CONSTRAINT "ck_attachment_target" CHECK ((
    ("app"."attachment"."status" = 'temp' AND "app"."attachment"."target_type" IS NULL AND "app"."attachment"."target_id" IS NULL
      AND "app"."attachment"."bound_at" IS NULL)
    OR ("app"."attachment"."status" in ('bound', 'removed') AND "app"."attachment"."target_type" in ('requirement', 'bug')
      AND "app"."attachment"."target_id" IS NOT NULL AND "app"."attachment"."bound_at" IS NOT NULL)
  ))
);
--> statement-breakpoint
CREATE TABLE "app"."bug_collaborator" (
	"id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"bug_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_bug_collaborator_id" PRIMARY KEY("id"),
	CONSTRAINT "uk_bug_collaborator" UNIQUE("bug_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "app"."storage_bucket" (
	"id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"is_builtin" boolean DEFAULT false NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'enabled' NOT NULL,
	"endpoint" text,
	"bucket_name" text,
	"region" text,
	"path_prefix" text,
	"access_key_hint" text,
	"credential_ciphertext" text,
	"credential_iv" text,
	"credential_auth_tag" text,
	"credential_key_version" integer,
	"last_probe_result" text,
	"last_probe_message" text,
	"last_probed_at" timestamp with time zone,
	"created_by_user_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_storage_bucket_id" PRIMARY KEY("id"),
	CONSTRAINT "uk_storage_bucket_name" UNIQUE("name"),
	CONSTRAINT "ck_storage_bucket_kind" CHECK ("app"."storage_bucket"."kind" in ('local', 's3')),
	CONSTRAINT "ck_storage_bucket_status" CHECK ("app"."storage_bucket"."status" in ('enabled', 'disabled')),
	CONSTRAINT "ck_storage_bucket_probe" CHECK ("app"."storage_bucket"."last_probe_result" is null or "app"."storage_bucket"."last_probe_result" in ('read_write', 'read_only', 'unreachable', 'auth_failed')),
	CONSTRAINT "ck_storage_bucket_s3_fields" CHECK ((
    ("app"."storage_bucket"."kind" = 's3' AND "app"."storage_bucket"."endpoint" IS NOT NULL AND "app"."storage_bucket"."bucket_name" IS NOT NULL
      AND "app"."storage_bucket"."region" IS NOT NULL AND "app"."storage_bucket"."credential_ciphertext" IS NOT NULL
      AND "app"."storage_bucket"."credential_iv" IS NOT NULL AND "app"."storage_bucket"."credential_auth_tag" IS NOT NULL
      AND "app"."storage_bucket"."credential_key_version" IS NOT NULL AND "app"."storage_bucket"."is_builtin" = false)
    OR ("app"."storage_bucket"."kind" = 'local' AND "app"."storage_bucket"."is_builtin" = true AND "app"."storage_bucket"."endpoint" IS NULL
      AND "app"."storage_bucket"."bucket_name" IS NULL AND "app"."storage_bucket"."region" IS NULL AND "app"."storage_bucket"."path_prefix" IS NULL
      AND "app"."storage_bucket"."access_key_hint" IS NULL AND "app"."storage_bucket"."credential_ciphertext" IS NULL
      AND "app"."storage_bucket"."credential_iv" IS NULL AND "app"."storage_bucket"."credential_auth_tag" IS NULL
      AND "app"."storage_bucket"."credential_key_version" IS NULL)
  ))
);
--> statement-breakpoint
CREATE TABLE "app"."storage_bucket_event" (
	"id" uuid NOT NULL,
	"bucket_id" uuid NOT NULL,
	"action" text NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"changes" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_storage_bucket_event_id" PRIMARY KEY("id"),
	CONSTRAINT "ck_storage_bucket_event_action" CHECK ("app"."storage_bucket_event"."action" in ('bucket_created', 'bucket_updated', 'bucket_probed', 'bucket_set_default', 'bucket_removed'))
);
--> statement-breakpoint
ALTER TABLE "app"."activity" DROP CONSTRAINT "ck_activity_entity_type";--> statement-breakpoint
CREATE INDEX "idx_attachment_target" ON "app"."attachment" USING btree ("target_type","target_id","created_at","id") WHERE "app"."attachment"."status" = 'bound';--> statement-breakpoint
CREATE INDEX "idx_attachment_bucket" ON "app"."attachment" USING btree ("bucket_id");--> statement-breakpoint
CREATE INDEX "idx_attachment_temp" ON "app"."attachment" USING btree ("created_at") WHERE "app"."attachment"."status" = 'temp';--> statement-breakpoint
CREATE INDEX "idx_attachment_removed" ON "app"."attachment" USING btree ("updated_at") WHERE "app"."attachment"."status" = 'removed';--> statement-breakpoint
CREATE INDEX "idx_attachment_project" ON "app"."attachment" USING btree ("project_id","created_at","id");--> statement-breakpoint
CREATE INDEX "idx_bug_collaborator_user" ON "app"."bug_collaborator" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uk_storage_bucket_default" ON "app"."storage_bucket" USING btree ("is_default") WHERE "app"."storage_bucket"."is_default";--> statement-breakpoint
CREATE INDEX "idx_storage_bucket_status" ON "app"."storage_bucket" USING btree ("status","created_at","id");--> statement-breakpoint
CREATE INDEX "idx_storage_bucket_event_bucket" ON "app"."storage_bucket_event" USING btree ("bucket_id","created_at","id");--> statement-breakpoint
ALTER TABLE "app"."activity" ADD CONSTRAINT "ck_activity_entity_type" CHECK ("app"."activity"."entity_type" in ('project', 'requirement', 'bug', 'code_reference', 'team_member', 'team', 'project_service', 'build_record', 'build_artifact', 'service_run_version', 'pipeline_run', 'pipeline_node', 'external_review', 'release_result', 'credential', 'credential_grant', 'project_env_var', 'skill', 'agent_template', 'attachment'));
-- 表与关键列中文说明；状态列注明取值含义。
COMMENT ON TABLE "app"."storage_bucket" IS '平台级储存桶配置；内置本地桶为初始默认，自定义桶为 S3 兼容协议';
COMMENT ON COLUMN "app"."storage_bucket"."kind" IS '桶类型：local 本地目录 / s3 S3 兼容对象存储';
COMMENT ON COLUMN "app"."storage_bucket"."is_builtin" IS '是否内置：内置本地桶不可删除、不可停用';
COMMENT ON COLUMN "app"."storage_bucket"."is_default" IS '是否当前默认桶；部分唯一索引保证同一时刻至多一个';
COMMENT ON COLUMN "app"."storage_bucket"."status" IS '状态：enabled 启用 / disabled 停用';
COMMENT ON COLUMN "app"."storage_bucket"."credential_ciphertext" IS 'S3 凭据 AES-256-GCM 密文（Access Key ID 与 Secret Access Key 的 JSON）';
COMMENT ON COLUMN "app"."storage_bucket"."access_key_hint" IS 'Access Key ID 掩码，仅供展示';
COMMENT ON COLUMN "app"."storage_bucket"."last_probe_result" IS '最近探测结论：read_write / read_only / unreachable / auth_failed';
COMMENT ON COLUMN "app"."storage_bucket"."version" IS '配置乐观锁版本号';
COMMENT ON TABLE "app"."storage_bucket_event" IS '储存桶配置变更审计；平台级事件不进入团队活动流';
COMMENT ON TABLE "app"."attachment" IS '业务附件；状态 temp 未绑定、bound 已绑定、removed 待删对象';
COMMENT ON COLUMN "app"."attachment"."bucket_id" IS '上传时选定的储存桶；读取时按该桶解析，不随默认桶切换变化';
COMMENT ON COLUMN "app"."attachment"."storage_key" IS '桶内对象键，由平台生成且不含用户文件名';
COMMENT ON COLUMN "app"."attachment"."size_bytes" IS '文件字节数';
COMMENT ON COLUMN "app"."attachment"."sha256" IS '服务端流式计算的文件 SHA-256';
COMMENT ON COLUMN "app"."attachment"."status" IS '状态：temp 临时 / bound 已绑定 / removed 待删除对象';
COMMENT ON COLUMN "app"."attachment"."target_type" IS '绑定目标类型：requirement / bug';
COMMENT ON TABLE "app"."bug_collaborator" IS '缺陷协作人员关系；只记录与展示，不授予权限';

-- 内置本地储存桶：固定 UUID；created_by_user_id 使用系统占位，不依赖 root 用户先存在。
INSERT INTO "app"."storage_bucket" (
  "id", "name", "kind", "is_builtin", "is_default", "status", "created_by_user_id"
) VALUES (
  '00000000-0000-4000-8000-000000000001', '本地储存', 'local', true, true, 'enabled',
  '00000000-0000-4000-8000-000000000000'
);
