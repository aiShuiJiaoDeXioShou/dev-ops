-- 保留旧连接及其关联标识，使历史项目和运行记录仍可追溯。
UPDATE app.git_repository AS repository
SET status = 'removed', updated_at = now()
FROM app.git_connection AS connection
WHERE repository.connection_id = connection.id
  AND connection.provider_key = 'github'
  AND connection.auth_kind = 'github_cli'
  AND repository.status <> 'removed';
--> statement-breakpoint
UPDATE app.git_connection
SET status = 'revoked', last_error_code = NULL, updated_at = now()
WHERE provider_key = 'github' AND auth_kind = 'github_cli' AND status <> 'revoked';
--> statement-breakpoint
COMMENT ON COLUMN app.git_connection.auth_kind IS '授权方式：github_app_installation、gitea_token；github_cli 仅保留已停用的历史连接';
