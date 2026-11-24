CREATE TABLE app.bot_run_token (
 id uuid CONSTRAINT pk_bot_run_token_id PRIMARY KEY DEFAULT gen_random_uuid(), team_id uuid NOT NULL, run_id uuid NOT NULL,
 bot_id uuid NOT NULL, user_id uuid NOT NULL, lease_epoch integer NOT NULL,
 token_hash text NOT NULL, revoked_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT uk_bot_run_token_hash UNIQUE(token_hash)
);
CREATE INDEX idx_bot_run_token_run_epoch ON app.bot_run_token(run_id, lease_epoch);
COMMENT ON TABLE app.bot_run_token IS 'Bot运行级令牌，仅保存哈希，按租约代次校验';
COMMENT ON COLUMN app.bot_run_token.id IS '令牌标识';
COMMENT ON COLUMN app.bot_run_token.team_id IS '所属团队';
COMMENT ON COLUMN app.bot_run_token.run_id IS '绑定运行';
COMMENT ON COLUMN app.bot_run_token.bot_id IS '绑定Bot';
COMMENT ON COLUMN app.bot_run_token.user_id IS '触发人';
COMMENT ON COLUMN app.bot_run_token.lease_epoch IS '签发时租约代次';
COMMENT ON COLUMN app.bot_run_token.token_hash IS 'SHA256哈希';
COMMENT ON COLUMN app.bot_run_token.revoked_at IS '撤销时间，空表示未显式撤销';
COMMENT ON COLUMN app.bot_run_token.created_at IS '创建时间';
COMMENT ON COLUMN app.bot_run_token.updated_at IS '更新时间';
