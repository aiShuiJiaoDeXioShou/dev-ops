CREATE TABLE "app"."project_file_cleanup" (
	"id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"delete_version" integer NOT NULL,
	"requested_by_user_id" uuid NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"lease_token" uuid,
	"lease_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_project_file_cleanup_id" PRIMARY KEY("id"),
	CONSTRAINT "uk_project_file_cleanup_version" UNIQUE("project_id","delete_version"),
	CONSTRAINT "ck_project_file_cleanup_status" CHECK ("app"."project_file_cleanup"."status" in ('queued', 'running', 'succeeded', 'failed')),
	CONSTRAINT "ck_project_file_cleanup_lease" CHECK (("app"."project_file_cleanup"."status" = 'running' and "app"."project_file_cleanup"."lease_token" is not null and "app"."project_file_cleanup"."lease_until" is not null)
        or ("app"."project_file_cleanup"."status" <> 'running' and "app"."project_file_cleanup"."lease_token" is null and "app"."project_file_cleanup"."lease_until" is null))
);
--> statement-breakpoint
CREATE TABLE "app"."project_password_limit" (
	"id" uuid NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"attempts" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_project_password_limit_id" PRIMARY KEY("id"),
	CONSTRAINT "ck_project_password_limit_attempts" CHECK ("app"."project_password_limit"."attempts" > 0)
);
--> statement-breakpoint
ALTER TABLE "app"."project" DROP CONSTRAINT "uk_project_team_name";--> statement-breakpoint
ALTER TABLE "app"."attachment" ADD COLUMN "purged_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app"."pipeline_artifact" ADD COLUMN "purged_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app"."project" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app"."project" ADD COLUMN "deleted_by_user_id" uuid;--> statement-breakpoint
CREATE INDEX "idx_project_file_cleanup_queue" ON "app"."project_file_cleanup" USING btree ("status","lease_until","created_at");--> statement-breakpoint
CREATE INDEX "idx_pipeline_artifact_project_purge" ON "app"."pipeline_artifact" USING btree ("project_id","id") WHERE "app"."pipeline_artifact"."purged_at" is null;--> statement-breakpoint
CREATE INDEX "idx_project_recycle_bin" ON "app"."project" USING btree ("team_id","deleted_at","id") WHERE "app"."project"."deleted_at" is not null;--> statement-breakpoint
ALTER TABLE "app"."project" ADD CONSTRAINT "ck_project_deleted_actor" CHECK (("app"."project"."deleted_at" is null) = ("app"."project"."deleted_by_user_id" is null));
--> statement-breakpoint
COMMENT ON COLUMN app.project.deleted_at IS '移入回收站的时间，为空表示项目正常可访问';
COMMENT ON COLUMN app.project.deleted_by_user_id IS '本次移入回收站的操作者，为空表示项目正常可访问';
COMMENT ON COLUMN app.attachment.purged_at IS '清理项目文件时删除附件对象的时间，附件元数据保留';
COMMENT ON COLUMN app.pipeline_artifact.purged_at IS '清理项目文件时删除产物对象的时间，产物元数据保留';
COMMENT ON TABLE app.project_file_cleanup IS '项目回收站的持久化文件清理任务';
COMMENT ON COLUMN app.project_file_cleanup.id IS '清理任务标识';
COMMENT ON COLUMN app.project_file_cleanup.project_id IS '被清理文件所属项目';
COMMENT ON COLUMN app.project_file_cleanup.team_id IS '项目所属团队';
COMMENT ON COLUMN app.project_file_cleanup.delete_version IS '移入回收站后的项目版本，用于区分历次删除';
COMMENT ON COLUMN app.project_file_cleanup.requested_by_user_id IS '发起清理或重试的账号';
COMMENT ON COLUMN app.project_file_cleanup.status IS 'queued 排队、running 执行中、succeeded 完成、failed 失败';
COMMENT ON COLUMN app.project_file_cleanup.lease_token IS '当前执行批次的租约令牌';
COMMENT ON COLUMN app.project_file_cleanup.lease_until IS '租约到期时间，过期后其他执行节点可接管';
COMMENT ON COLUMN app.project_file_cleanup.created_at IS '记录创建时间';
COMMENT ON COLUMN app.project_file_cleanup.updated_at IS '记录更新时间';
COMMENT ON TABLE app.project_password_limit IS '项目删除和文件清理共用的账号密码验证限流计数';
COMMENT ON COLUMN app.project_password_limit.id IS '登录账号标识';
COMMENT ON COLUMN app.project_password_limit.window_start IS '当前限流窗口的起始时间';
COMMENT ON COLUMN app.project_password_limit.attempts IS '当前窗口内已受理验证的次数';
COMMENT ON COLUMN app.project_password_limit.created_at IS '记录创建时间';
COMMENT ON COLUMN app.project_password_limit.updated_at IS '记录更新时间';
