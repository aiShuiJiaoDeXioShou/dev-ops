CREATE SCHEMA "app";
--> statement-breakpoint
COMMENT ON SCHEMA "app" IS '应用业务数据，结构由迁移账号维护';
--> statement-breakpoint
REVOKE ALL ON SCHEMA "app" FROM PUBLIC;
--> statement-breakpoint
GRANT USAGE ON SCHEMA "app" TO dev_ops_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA "app"
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO dev_ops_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA "app"
  GRANT USAGE, SELECT ON SEQUENCES TO dev_ops_app;
