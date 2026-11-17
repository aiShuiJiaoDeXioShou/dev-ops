-- 只解除指向待删除变更计划的证据链接，保留运行版本及其确认历史。
UPDATE "app"."service_run_version" AS version
SET "evidence_url" = NULL
FROM "app"."change_plan" AS plan
WHERE plan."id" = substring(version."evidence_url" FROM '^https?://[^/?#]+/operations/changes/([[:xdigit:]]{8}-[[:xdigit:]]{4}-[[:xdigit:]]{4}-[[:xdigit:]]{4}-[[:xdigit:]]{12})/?([?#].*)?$')::uuid;
--> statement-breakpoint
UPDATE "app"."service_run_version_change" AS version
SET "evidence_url" = NULL
FROM "app"."change_plan" AS plan
WHERE plan."id" = substring(version."evidence_url" FROM '^https?://[^/?#]+/operations/changes/([[:xdigit:]]{8}-[[:xdigit:]]{4}-[[:xdigit:]]{4}-[[:xdigit:]]{4}-[[:xdigit:]]{12})/?([?#].*)?$')::uuid;
--> statement-breakpoint
DROP TABLE "app"."change_execution";--> statement-breakpoint
DROP TABLE "app"."change_plan";--> statement-breakpoint
DROP TABLE "app"."change_plan_approval";--> statement-breakpoint
DROP TABLE "app"."change_plan_event";
