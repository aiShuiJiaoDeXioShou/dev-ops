#!/usr/bin/env bash
set -euo pipefail
umask 077

# DevOps 平台原生部署与初始化脚本（支持 macOS launchd 与 Linux systemd）。
# 目录结构与同目录下的 release-main.sh 保持一致，便于接入 Mac mini 自举发布。

DEPLOY_ROOT="${DEVOPS_DEPLOY_ROOT:-$HOME/deploy/dev-ops}"
APP_ORIGIN="${DEVOPS_APP_ORIGIN:-http://127.0.0.1:8080}"
HTTP_HOST="${DEVOPS_HTTP_HOST:-127.0.0.1}"
HTTP_PORT="${DEVOPS_HTTP_PORT:-3001}"
DB_HOST="${DEVOPS_DB_HOST:-127.0.0.1}"
DB_PORT="${DEVOPS_DB_PORT:-5433}"
DB_NAME="${DEVOPS_DB_NAME:-dev_ops}"
SOURCE_DIR=""
INIT_ONLY=0
SKIP_BUILD=0
SKIP_MIGRATE=0
SEED_ROOT=0

usage() {
  cat <<'EOF'
DevOps 平台生产部署脚本

用法:
  ./.devops/scripts/deploy.sh [选项]

选项:
  --root <目录>         部署根目录（默认: ~/deploy/dev-ops）
  --origin <URL>        对外访问地址，不含尾部斜杠（默认: http://127.0.0.1:8080）
  --host <地址>         HTTP API 监听地址（默认: 127.0.0.1）
  --port <端口>         HTTP API 监听端口（默认: 3001）
  --db-host <主机>      PostgreSQL 主机（默认: 127.0.0.1）
  --db-port <端口>      PostgreSQL 端口（默认: 5433）
  --db-name <库名>      PostgreSQL 数据库名（默认: dev_ops）
  --init-only           仅初始化目录、环境配置文件与服务模板，不构建与迁移
  --skip-build          跳过依赖安装与构建（要求当前工作区已完成 pnpm build）
  --skip-migrate        跳过数据库迁移（适用于数据库尚未就绪的预部署）
  --seed-root           迁移后初始化平台 root 账号（需通过环境变量提供 ROOT_EMAIL 与 ROOT_INITIAL_PASSWORD）
  -h, --help            显示此帮助信息

环境变量:
  DEVOPS_DEPLOY_ROOT    等同于 --root
  DEVOPS_APP_ORIGIN     等同于 --origin
  ROOT_EMAIL            配合 --seed-root 使用，平台 root 登录邮箱
  ROOT_INITIAL_PASSWORD 配合 --seed-root 使用，平台 root 初始密码

目录结构:
  <root>/
  ├── releases/<sha>/   按提交隔离的构建产物
  ├── current -> ...    当前生效版本软链
  ├── shared/           app.env / migration.env / 服务模板与 Nginx 配置（0600 保护敏感配置）
  ├── data/             pipeline / attachments / bot 持久化业务数据目录
  └── logs/             服务运行日志
EOF
}

log() {
  printf '[devops-deploy] %s\n' "$*"
}

die() {
  printf '[devops-deploy] 错误: %s\n' "$*" >&2
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --root)
      [[ $# -ge 2 ]] || die '--root 缺少参数'
      DEPLOY_ROOT="$2"
      shift 2
      ;;
    --origin)
      [[ $# -ge 2 ]] || die '--origin 缺少参数'
      APP_ORIGIN="${2%/}"
      shift 2
      ;;
    --host)
      [[ $# -ge 2 ]] || die '--host 缺少参数'
      HTTP_HOST="$2"
      shift 2
      ;;
    --port)
      [[ $# -ge 2 ]] || die '--port 缺少参数'
      HTTP_PORT="$2"
      shift 2
      ;;
    --db-host)
      [[ $# -ge 2 ]] || die '--db-host 缺少参数'
      DB_HOST="$2"
      shift 2
      ;;
    --db-port)
      [[ $# -ge 2 ]] || die '--db-port 缺少参数'
      DB_PORT="$2"
      shift 2
      ;;
    --db-name)
      [[ $# -ge 2 ]] || die '--db-name 缺少参数'
      DB_NAME="$2"
      shift 2
      ;;
    --init-only)
      INIT_ONLY=1
      shift
      ;;
    --skip-build)
      SKIP_BUILD=1
      shift
      ;;
    --skip-migrate)
      SKIP_MIGRATE=1
      shift
      ;;
    --seed-root)
      SEED_ROOT=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "未知参数: ${1}（使用 --help 查看用法）"
      ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
[[ -f "$SOURCE_DIR/apps/server/package.json" && -f "$SOURCE_DIR/apps/web/package.json" ]] || \
  die "请在 dev-ops 仓库内运行本脚本（当前路径: ${SOURCE_DIR}）"

# 校验 Node.js 24 运行环境。
command -v node >/dev/null 2>&1 || die '未找到 node，请先安装 Node.js 24（建议 24.15.0+）'
NODE_BIN="$(command -v node)"
NODE_VERSION="$("$NODE_BIN" -p 'process.versions.node')"
NODE_MAJOR="${NODE_VERSION%%.*}"
NODE_REST="${NODE_VERSION#*.}"
NODE_MINOR="${NODE_REST%%.*}"
if [[ "$NODE_MAJOR" -ne 24 || "$NODE_MINOR" -lt 15 ]]; then
  die "当前 Node.js 版本为 v${NODE_VERSION}，需要 >=24.15.0 且 <25"
fi

resolve_pnpm() {
  if command -v pnpm >/dev/null 2>&1; then
    PNPM_CMD=(pnpm)
    return 0
  fi
  if command -v corepack >/dev/null 2>&1; then
    corepack enable pnpm >/dev/null 2>&1 || true
    PNPM_CMD=(corepack pnpm)
    return 0
  fi
  die '未找到 pnpm 或 corepack，请先安装 pnpm 11'
}

SHARED_DIR="$DEPLOY_ROOT/shared"
RELEASES_DIR="$DEPLOY_ROOT/releases"
DATA_DIR="$DEPLOY_ROOT/data"
LOGS_DIR="$DEPLOY_ROOT/logs"
CURRENT_LINK="$DEPLOY_ROOT/current"

# 1. 创建标准部署目录结构。
mkdir -p \
  "$SHARED_DIR/services" \
  "$RELEASES_DIR" \
  "$DATA_DIR/pipeline" \
  "$DATA_DIR/attachments" \
  "$DATA_DIR/bot" \
  "$LOGS_DIR"

# 2. 首次初始化生成强随机密钥的共享环境配置，已有配置绝不覆盖。
APP_ENV="$SHARED_DIR/app.env"
MIGRATION_ENV="$SHARED_DIR/migration.env"
ENV_CREATED=0

if [[ ! -f "$APP_ENV" ]]; then
  APP_DB_PASS="$("$NODE_BIN" -e "console.log(require('node:crypto').randomBytes(24).toString('hex'))")"
  AUTH_SECRET="$("$NODE_BIN" -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))")"
  CRED_KEY="$("$NODE_BIN" -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))")"
  cat > "$APP_ENV" <<EOF
# DevOps 生产应用配置（供 http / worker / bot-worker 共用，请妥善备份密钥）
NODE_ENV=production
HOST=${HTTP_HOST}
PORT=${HTTP_PORT}
LOG_LEVEL=info
DOCS_ENABLED=false

# 请确保以下密码与 PostgreSQL dev_ops_app 角色一致
DATABASE_URL=postgresql://dev_ops_app:${APP_DB_PASS}@${DB_HOST}:${DB_PORT}/${DB_NAME}
DB_POOL_MAX=10

APP_ORIGIN=${APP_ORIGIN}
AUTH_SECRET=${AUTH_SECRET}
AUTH_TRUSTED_ORIGINS=${APP_ORIGIN}

# 32 字节 Base64 凭据加密密钥，轮换前请勿丢失
GIT_CREDENTIAL_ENCRYPTION_KEY=${CRED_KEY}

# 邮件配置（发送团队邀请与密码重置邮件，按需取消注释并填写真实配置）
# SMTP_URL=smtps://resend:<api-key>@smtp.resend.com:465
# MAIL_FROM=noreply@example.com

# 持久化存储目录（位于发布目录之外，升级与回滚保留数据）
PIPELINE_STORAGE_DIR=${DATA_DIR}/pipeline
ATTACHMENT_STORAGE_DIR=${DATA_DIR}/attachments
BOT_WORKSPACE_DIR=${DATA_DIR}/bot

# Bot 执行并发与时限
BOT_GLOBAL_CONCURRENCY=4
BOT_TEAM_CONCURRENCY=2
BOT_RUN_TIMEOUT_SECONDS=1800
EOF
  chmod 0600 "$APP_ENV"
  ENV_CREATED=1
  log "已生成应用配置: ${APP_ENV}（权限 0600）"
else
  log "保留已有应用配置: ${APP_ENV}"
fi

if [[ ! -f "$MIGRATION_ENV" ]]; then
  MIGRATOR_DB_PASS="$("$NODE_BIN" -e "console.log(require('node:crypto').randomBytes(24).toString('hex'))")"
  cat > "$MIGRATION_ENV" <<EOF
# DevOps 数据库迁移配置（仅迁移命令读取，不注入常驻应用进程）
MIGRATION_DATABASE_URL=postgresql://dev_ops_migrator:${MIGRATOR_DB_PASS}@${DB_HOST}:${DB_PORT}/${DB_NAME}
EOF
  chmod 0600 "$MIGRATION_ENV"
  ENV_CREATED=1
  log "已生成迁移配置: ${MIGRATION_ENV}（权限 0600）"
else
  log "保留已有迁移配置: ${MIGRATION_ENV}"
fi

# 3. 生成 Nginx 反向代理配置与操作系统守护进程模板。
NGINX_CONF="$SHARED_DIR/nginx-devops.conf"
cat > "$NGINX_CONF" <<EOF
# 将此片段放入 Nginx 的 HTTPS server 块中
root ${CURRENT_LINK}/apps/web/dist;

location / {
    try_files \$uri \$uri/ /index.html;
}

location /api/ {
    proxy_pass http://${HTTP_HOST}:${HTTP_PORT};
    proxy_http_version 1.1;
    proxy_set_header Host \$http_host;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_request_buffering off;
    proxy_buffering off;
    client_max_body_size 500m;
}
EOF
chmod 0644 "$NGINX_CONF"

OS_NAME="$(uname -s)"
CURRENT_USER="$(id -un)"

if [[ "$OS_NAME" == "Darwin" ]]; then
  for svc in http worker bot-worker; do
    cat > "$SHARED_DIR/services/com.devops.${svc}.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.devops.${svc}</string>
  <key>WorkingDirectory</key>
  <string>${CURRENT_LINK}/apps/server</string>
  <key>ProgramArguments</key>
  <array>
    <string>${NODE_BIN}</string>
    <string>--env-file</string>
    <string>${APP_ENV}</string>
    <string>${CURRENT_LINK}/apps/server/dist/entrypoints/${svc}.js</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${LOGS_DIR}/${svc}.out.log</string>
  <key>StandardErrorPath</key>
  <string>${LOGS_DIR}/${svc}.err.log</string>
</dict>
</plist>
EOF
    chmod 0644 "$SHARED_DIR/services/com.devops.${svc}.plist"
  done
  log "已生成 macOS launchd 服务模板: $SHARED_DIR/services/com.devops.*.plist"
else
  for svc in http worker bot-worker; do
    cat > "$SHARED_DIR/services/devops-${svc}.service" <<EOF
[Unit]
Description=DevOps Platform (${svc})
After=network-online.target postgresql.service
Wants=network-online.target

[Service]
Type=simple
User=${CURRENT_USER}
WorkingDirectory=${CURRENT_LINK}/apps/server
ExecStart=${NODE_BIN} --env-file ${APP_ENV} ${CURRENT_LINK}/apps/server/dist/entrypoints/${svc}.js
Restart=always
RestartSec=3
StandardOutput=append:${LOGS_DIR}/${svc}.out.log
StandardError=append:${LOGS_DIR}/${svc}.err.log

[Install]
WantedBy=multi-user.target
EOF
    chmod 0644 "$SHARED_DIR/services/devops-${svc}.service"
  done
  log "已生成 Linux systemd 服务模板: $SHARED_DIR/services/devops-*.service"
fi

if [[ "$INIT_ONLY" -eq 1 ]]; then
  log '已完成目录、配置与服务模板初始化（--init-only）。'
  log "请先用 deploy/postgres/init.sql 初始化 PostgreSQL 18 并核对 $APP_ENV 与 $MIGRATION_ENV 中的数据库密码，再执行 ./.devops/scripts/deploy.sh 完成发布。"
  exit 0
fi

# 4. 构建工作区产物并按提交 SHA 落盘到 releases/。
COMMIT_SHA="$(git -C "$SOURCE_DIR" rev-parse HEAD 2>/dev/null || date +%Y%m%d%H%M%S)"
TARGET_RELEASE="$RELEASES_DIR/$COMMIT_SHA"

if [[ "$SKIP_BUILD" -eq 0 ]]; then
  resolve_pnpm
  if [[ ! -f "$SOURCE_DIR/packages/devops-bot/package.json" ]]; then
    log '初始化 packages/devops-bot 子模块...'
    git -C "$SOURCE_DIR" submodule update --init --recursive
  fi
  log '安装依赖并构建全工作区产物...'
  (
    cd "$SOURCE_DIR"
    "${PNPM_CMD[@]}" install --frozen-lockfile
    "${PNPM_CMD[@]}" build
  )
fi

[[ -f "$SOURCE_DIR/apps/server/dist/entrypoints/http.js" ]] || die '缺少服务端构建产物，请先运行 pnpm build'
[[ -f "$SOURCE_DIR/apps/web/dist/index.html" ]] || die '缺少前端构建产物，请先运行 pnpm build'

# 同步当前构建到独立发布目录，保留现有 releases 不影响回滚。
if [[ -d "$TARGET_RELEASE" ]]; then
  rm -rf "$TARGET_RELEASE"
fi
mkdir -p "$TARGET_RELEASE"
log "打包发布目录: $TARGET_RELEASE"
tar -C "$SOURCE_DIR" \
  --exclude='.git' \
  --exclude='.artifacts' \
  --exclude='.playwright-mcp' \
  --exclude='.pnpm-store' \
  --exclude='.secrets' \
  --exclude='.tmp' \
  --exclude='bot-data' \
  --exclude='work' \
  --exclude='draft_*' \
  --exclude='apps/server/.env' \
  --exclude='apps/server/.env.database' \
  --exclude='apps/pipeline-agent/.env' \
  --exclude='apps/cli/.env' \
  -cf - . | tar -C "$TARGET_RELEASE" -xf -
printf '%s\n' "$COMMIT_SHA" > "$TARGET_RELEASE/.devops-build-complete"

# 5. 执行数据库迁移（新生成随机密码时先提示管理员同步数据库角色密码）。
if [[ "$SKIP_MIGRATE" -eq 0 ]]; then
  if [[ "$ENV_CREATED" -eq 1 ]]; then
    log "首次生成了新配置，请先在 PostgreSQL 18 中按 $APP_ENV 与 $MIGRATION_ENV 密码执行 deploy/postgres/init.sql，随后运行:"
    printf '  cd "%s/apps/server" && "%s" --env-file "%s" dist/entrypoints/migrate.js\n' \
      "$TARGET_RELEASE" "$NODE_BIN" "$MIGRATION_ENV"
  else
    log '执行数据库迁移...'
    (
      cd "$TARGET_RELEASE/apps/server"
      "$NODE_BIN" --env-file "$MIGRATION_ENV" dist/entrypoints/migrate.js
    )
    if [[ "$SEED_ROOT" -eq 1 ]]; then
      [[ -n "${ROOT_EMAIL:-}" && -n "${ROOT_INITIAL_PASSWORD:-}" ]] || \
        die '--seed-root 需要环境变量 ROOT_EMAIL 与 ROOT_INITIAL_PASSWORD'
      log '初始化平台 root 账号...'
      (
        cd "$TARGET_RELEASE/apps/server"
        "$NODE_BIN" --env-file "$APP_ENV" --import tsx scripts/seed-root.ts
      )
    fi
  fi
fi

# 6. 原子切换 current 软链（兼容 macOS BSD mv -h 与 Linux GNU mv -T）。
TMP_LINK="$RELEASES_DIR/.current.$$"
ln -s "$TARGET_RELEASE" "$TMP_LINK"
if [[ "$OS_NAME" == "Darwin" ]]; then
  mv -fh "$TMP_LINK" "$CURRENT_LINK"
else
  mv -fT "$TMP_LINK" "$CURRENT_LINK"
fi

log "发布目录已切换: $CURRENT_LINK -> $TARGET_RELEASE"
printf '\n'
log "Nginx 配置片段: $NGINX_CONF"
if [[ "$OS_NAME" == "Darwin" ]]; then
  log '安装并启动 macOS launchd 服务（用户态示例）:'
  cat <<EOF
  cp "$SHARED_DIR/services"/com.devops.*.plist ~/Library/LaunchAgents/
  for svc in http worker bot-worker; do
    launchctl bootout "gui/\$(id -u)/com.devops.\$svc" 2>/dev/null || true
    launchctl bootstrap "gui/\$(id -u)" ~/Library/LaunchAgents/com.devops.\$svc.plist
  done
EOF
else
  log '安装并启动 Linux systemd 服务:'
  cat <<EOF
  sudo cp "$SHARED_DIR/services"/devops-*.service /etc/systemd/system/
  sudo systemctl daemon-reload
  sudo systemctl enable --now devops-http devops-worker devops-bot-worker
EOF
fi
printf '\n'
log "验证服务就绪: curl -fsS http://${HTTP_HOST}:${HTTP_PORT}/api/v1/ready"
