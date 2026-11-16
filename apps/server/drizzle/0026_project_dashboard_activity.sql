CREATE TABLE "app"."project_dashboard_day" (
	"id" bigint GENERATED ALWAYS AS IDENTITY (sequence name "app"."project_dashboard_day_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"repository_id" uuid NOT NULL,
	"source" text NOT NULL,
	"activity_date" date NOT NULL,
	"activity_count" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_project_dashboard_day_id" PRIMARY KEY("id"),
	CONSTRAINT "uk_project_dashboard_day_repository_source_date" UNIQUE("repository_id","source","activity_date"),
	CONSTRAINT "ck_project_dashboard_day_source" CHECK ("app"."project_dashboard_day"."source" in ('code', 'pull_request')),
	CONSTRAINT "ck_project_dashboard_day_count" CHECK ("app"."project_dashboard_day"."activity_count" > 0)
);
--> statement-breakpoint
CREATE TABLE "app"."project_dashboard_pull_request" (
	"id" bigint GENERATED ALWAYS AS IDENTITY (sequence name "app"."project_dashboard_pull_request_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"repository_id" uuid NOT NULL,
	"remote_number" bigint NOT NULL,
	"opened_on" date NOT NULL,
	"remote_updated_at" timestamp with time zone NOT NULL,
	"is_open" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_project_dashboard_pull_request_id" PRIMARY KEY("id"),
	CONSTRAINT "uk_project_dashboard_pull_request_repository_number" UNIQUE("repository_id","remote_number"),
	CONSTRAINT "ck_project_dashboard_pull_request_number" CHECK ("app"."project_dashboard_pull_request"."remote_number" > 0)
);
--> statement-breakpoint
CREATE TABLE "app"."project_dashboard_repository" (
	"id" uuid NOT NULL,
	"next_sync_at" timestamp with time zone NOT NULL,
	"lease_token" uuid,
	"commit_branch" text,
	"commit_head" text,
	"commit_from" date,
	"commit_checked_at" timestamp with time zone,
	"commits_available" boolean DEFAULT false NOT NULL,
	"pull_request_from" date,
	"pull_request_checked_at" timestamp with time zone,
	"pull_request_reconciled_at" timestamp with time zone,
	"pull_requests_available" boolean DEFAULT false NOT NULL,
	"open_pull_requests" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_project_dashboard_repository_id" PRIMARY KEY("id"),
	CONSTRAINT "ck_project_dashboard_repository_open" CHECK ("app"."project_dashboard_repository"."open_pull_requests" >= 0)
);
--> statement-breakpoint
CREATE INDEX "idx_project_dashboard_pull_request_repository_date" ON "app"."project_dashboard_pull_request" USING btree ("repository_id","opened_on");--> statement-breakpoint
CREATE INDEX "idx_project_dashboard_repository_due" ON "app"."project_dashboard_repository" USING btree ("next_sync_at","id");
--> statement-breakpoint
COMMENT ON TABLE app.project_dashboard_day IS '项目晴雨表按仓库、UTC 日期和来源保存的正数活动计数';
--> statement-breakpoint
COMMENT ON COLUMN app.project_dashboard_day.id IS '活动计数行标识';
--> statement-breakpoint
COMMENT ON COLUMN app.project_dashboard_day.repository_id IS '平台 Git 仓库标识';
--> statement-breakpoint
COMMENT ON COLUMN app.project_dashboard_day.source IS '统计来源，code 为默认分支提交，pull_request 为新建 PR';
--> statement-breakpoint
COMMENT ON COLUMN app.project_dashboard_day.activity_date IS '活动发生的 UTC 日期';
--> statement-breakpoint
COMMENT ON COLUMN app.project_dashboard_day.activity_count IS '当日活动条数，零值不落库';
--> statement-breakpoint
COMMENT ON COLUMN app.project_dashboard_day.created_at IS '首写时间';
--> statement-breakpoint
COMMENT ON COLUMN app.project_dashboard_day.updated_at IS '计数更新时间';
--> statement-breakpoint
COMMENT ON TABLE app.project_dashboard_pull_request IS '晴雨表 PR 去重与未关闭计数所需的最小事实，保留窗口内记录及仍打开的旧记录';
--> statement-breakpoint
COMMENT ON COLUMN app.project_dashboard_pull_request.id IS 'PR 事实行标识';
--> statement-breakpoint
COMMENT ON COLUMN app.project_dashboard_pull_request.repository_id IS '平台 Git 仓库标识';
--> statement-breakpoint
COMMENT ON COLUMN app.project_dashboard_pull_request.remote_number IS '远端仓库内的 PR 编号';
--> statement-breakpoint
COMMENT ON COLUMN app.project_dashboard_pull_request.opened_on IS 'PR 创建的 UTC 日期';
--> statement-breakpoint
COMMENT ON COLUMN app.project_dashboard_pull_request.remote_updated_at IS 'PR 来源更新时间，用于拒绝旧状态';
--> statement-breakpoint
COMMENT ON COLUMN app.project_dashboard_pull_request.is_open IS '当前是否仍打开';
--> statement-breakpoint
COMMENT ON COLUMN app.project_dashboard_pull_request.created_at IS '首次收录时间';
--> statement-breakpoint
COMMENT ON COLUMN app.project_dashboard_pull_request.updated_at IS '缓存内事实更新时间';
--> statement-breakpoint
COMMENT ON TABLE app.project_dashboard_repository IS '晴雨表仓库来源同步进度、可用性与多 Worker 领取租约';
--> statement-breakpoint
COMMENT ON COLUMN app.project_dashboard_repository.id IS '平台 Git 仓库标识，同一仓库只有一份同步进度';
--> statement-breakpoint
COMMENT ON COLUMN app.project_dashboard_repository.next_sync_at IS '下次允许领取的时间；持有租约时为租约超时点';
--> statement-breakpoint
COMMENT ON COLUMN app.project_dashboard_repository.lease_token IS '当前 Worker 本次发布的校验令牌；无租约时为空';
--> statement-breakpoint
COMMENT ON COLUMN app.project_dashboard_repository.commit_branch IS '上次成功读取的默认分支；未配置或未同步时为空';
--> statement-breakpoint
COMMENT ON COLUMN app.project_dashboard_repository.commit_head IS '上次同步覆盖的提交标识；空分支或未同步时为空';
--> statement-breakpoint
COMMENT ON COLUMN app.project_dashboard_repository.commit_from IS '提交计数覆盖的 UTC 起始日；未同步时为空';
--> statement-breakpoint
COMMENT ON COLUMN app.project_dashboard_repository.commit_checked_at IS '上次提交同步开始时间；未同步时为空';
--> statement-breakpoint
COMMENT ON COLUMN app.project_dashboard_repository.commits_available IS '最近一次提交同步是否成功';
--> statement-breakpoint
COMMENT ON COLUMN app.project_dashboard_repository.pull_request_from IS 'PR 创建计数覆盖的 UTC 起始日；未同步时为空';
--> statement-breakpoint
COMMENT ON COLUMN app.project_dashboard_repository.pull_request_checked_at IS '上次成功 PR 同步的开始时间，也是下次增量查询游标；未同步时为空';
--> statement-breakpoint
COMMENT ON COLUMN app.project_dashboard_repository.pull_request_reconciled_at IS '上次全量核对开始时间；未核对时为空';
--> statement-breakpoint
COMMENT ON COLUMN app.project_dashboard_repository.pull_requests_available IS '最近一次 PR 同步是否成功';
--> statement-breakpoint
COMMENT ON COLUMN app.project_dashboard_repository.open_pull_requests IS '仍打开的 PR 条数，含窗口外记录；未同步时为空';
--> statement-breakpoint
COMMENT ON COLUMN app.project_dashboard_repository.created_at IS '首次领取时间';
--> statement-breakpoint
COMMENT ON COLUMN app.project_dashboard_repository.updated_at IS '租约或同步状态更新时间';
