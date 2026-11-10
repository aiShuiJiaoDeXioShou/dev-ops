CREATE TABLE "app"."idempotency_record" (
	"id" uuid NOT NULL,
	"team_id" uuid,
	"actor_user_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"response_entity_type" text NOT NULL,
	"response_entity_id" uuid,
	"status_code" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_idempotency_record_id" PRIMARY KEY("id"),
	CONSTRAINT "uk_idempotency_scope" UNIQUE("team_id","actor_user_id","scope","idempotency_key")
);
--> statement-breakpoint
CREATE INDEX "idx_idempotency_created_at" ON "app"."idempotency_record" USING btree ("created_at");
COMMENT ON TABLE "app"."idempotency_record" IS '幂等请求记录，保留 24 小时';
COMMENT ON COLUMN "app"."idempotency_record"."id" IS '记录主键（UUID）';
COMMENT ON COLUMN "app"."idempotency_record"."team_id" IS '可选所属团队标识';
COMMENT ON COLUMN "app"."idempotency_record"."actor_user_id" IS '请求操作者标识';
COMMENT ON COLUMN "app"."idempotency_record"."scope" IS '幂等作用域，例如 requirement.submit-test';
COMMENT ON COLUMN "app"."idempotency_record"."idempotency_key" IS '客户端幂等键';
COMMENT ON COLUMN "app"."idempotency_record"."request_hash" IS '规范化请求体 SHA-256';
COMMENT ON COLUMN "app"."idempotency_record"."response_entity_type" IS '结果实体类型';
COMMENT ON COLUMN "app"."idempotency_record"."response_entity_id" IS '结果实体标识';
COMMENT ON COLUMN "app"."idempotency_record"."status_code" IS '成功响应状态码';
COMMENT ON COLUMN "app"."idempotency_record"."created_at" IS '创建时间';
COMMENT ON COLUMN "app"."idempotency_record"."updated_at" IS '更新时间';
