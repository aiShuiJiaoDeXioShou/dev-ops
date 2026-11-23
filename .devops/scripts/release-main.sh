#!/bin/bash
set -euo pipefail
umask 077

commit="${1:?请提供流水线固定的提交 SHA}"
[[ "$commit" =~ ^[0-9a-f]{40}$ ]] || { echo '提交 SHA 不合法' >&2; exit 2; }
base="${DEVOPS_DEPLOY_ROOT:-$HOME/deploy/dev-ops}"
repo="${DEVOPS_DEPLOY_REPOSITORY:?缺少部署仓库地址}"
git_token="${DEVOPS_DEPLOY_GIT_TOKEN:-}"
unset DEVOPS_DEPLOY_GIT_TOKEN
target="$base/releases/$commit"
shared="$base/shared"
domain="gui/$(id -u)"
node="$(command -v node)"
current="$base/current"
current_url=""
service_prefix=""
lock="$shared/native-release.lock"
[[ -d "$base/releases" && -f "$shared/app.env" && -f "$shared/migration.env" ]] || {
  echo '部署目录或共享配置未初始化' >&2
  exit 1
}
mkdir "$lock" 2>/dev/null || { echo '已有原生发布正在执行' >&2; exit 1; }

stage=""
activated=0
previous="$(readlink "$current" || true)"
git_command=(git -c http.version=HTTP/1.1)
if [[ -n "${DEVOPS_DEPLOY_GIT_PROXY:-}" ]]; then
  git_command+=(-c "http.https://github.com.proxy=$DEVOPS_DEPLOY_GIT_PROXY")
fi

switch_release() {
  ln -s "$1" "$stage/current"
  mv -fh "$stage/current" "$current"
}

select_deployment() {
  local prefix job
  for prefix in com.apple-macmini.devops com.devops; do
    job="$(launchctl print "$domain/$prefix.http" 2>/dev/null)" || continue
    # 同一用户可能运行多个实例，只重启当前部署目录下的服务。
    if [[ "$job" != *"$shared/app.env"* || "$job" != *"$current/apps/server/dist/entrypoints/http.js"* ]]; then
      continue
    fi
    service_prefix="$prefix"
    if [[ "$prefix" == com.apple-macmini.devops ]]; then
      current_url="http://127.0.0.1:18080"
    else
      current_url="$("$node" --env-file "$shared/app.env" -e 'process.stdout.write(new URL(process.env.APP_ORIGIN).origin)')"
    fi
    return
  done
  echo '未找到使用当前部署目录的 launchd HTTP 服务' >&2
  return 1
}

restart_app() {
  local service
  for service in http worker bot-worker; do
    launchctl kickstart -k "$domain/$service_prefix.$service" || return
  done
}

check_ready() {
  local attempt
  for attempt in {1..30}; do
    if curl --noproxy '*' -fs --max-time 3 "$current_url/api/v1/ready" | "$node" -e '
      let body = "";
      process.stdin.on("data", (data) => { body += data });
      process.stdin.on("end", () => { process.exitCode = JSON.parse(body).success === true ? 0 : 1 });
    ' 2>/dev/null; then
      return 0
    fi
    sleep 1
  done
  return 1
}

check_release() {
  check_ready && curl --noproxy '*' -fsS --max-time 8 "$current_url/login" | grep 'id="root"' >/dev/null
}

cleanup() {
  local status=$?
  trap - EXIT
  if [[ "$status" -ne 0 && "$activated" -eq 1 ]]; then
    echo '发布未通过，恢复上一版本' >&2
    if ! switch_release "$previous" || ! restart_app || ! check_release; then
      echo '上一版本未恢复就绪，请检查 launchd 和部署日志' >&2
    fi
  fi
  if [[ -n "$stage" ]] && ! rm -rf -- "$stage"; then
    echo "无法清理发布临时目录 $stage" >&2
  fi
  if ! rmdir "$lock"; then echo "无法解除发布锁 $lock" >&2; fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 143' TERM
trap 'exit 130' INT

# Agent 只传入固定的提交，发布脚本从指定仓库的 main 获取源码。
head_sha="$("${git_command[@]}" ls-remote --exit-code "$repo" refs/heads/main | cut -f1)"
[[ "$head_sha" == "$commit" ]] || { echo '待发布提交不是当前 main 的 HEAD' >&2; exit 1; }
[[ -L "$current" && -d "$previous" ]] || { echo '当前原生部署损坏或尚未初始化' >&2; exit 1; }
select_deployment
if [[ "$previous" == "$target" ]]; then
  check_release
  echo "当前已运行 $commit"
  exit 0
fi

stage="$(mktemp -d "$base/releases/.native-release.XXXXXXXX")"
if [[ ! -e "$target" ]]; then
  "${git_command[@]}" clone --depth 1 --single-branch --branch main "$repo" "$stage/source"
  [[ "$(git -C "$stage/source" rev-parse HEAD)" == "$commit" ]] || { echo '构建前 main 已更新' >&2; exit 1; }
  if [[ -n "$git_token" ]]; then
    # 私有 Bot 子模块使用同一安装的短期令牌，并限定到该子模块的 HTTPS 地址。
    submodule_url="${repo%/*}/devops-bot.git"
    auth_header="$(printf 'x-access-token:%s' "$git_token" | base64 | tr -d '\n')"
    GIT_CONFIG_COUNT=1 \
      GIT_CONFIG_KEY_0="http.$submodule_url.extraHeader" \
      GIT_CONFIG_VALUE_0="Authorization: Basic $auth_header" \
      "${git_command[@]}" -C "$stage/source" submodule update --init --recursive
    unset auth_header git_token
  else
    "${git_command[@]}" -C "$stage/source" submodule update --init --recursive
  fi
  (
    cd "$stage/source"
    corepack pnpm install --frozen-lockfile
    corepack pnpm build
  )
  printf '%s\n' "$commit" > "$stage/source/.devops-build-complete"
  mv "$stage/source" "$target"
fi

[[ "$(cat "$target/.devops-build-complete")" == "$commit" ]]
# 数据库迁移独立于发布目录，应用继续读取共享配置和数据。
(
  cd "$target/apps/server"
  "$node" --env-file "$shared/migration.env" dist/entrypoints/migrate.js
)
# 构建期间若 main 前进，等待该提交自己的流水线接管发布。
[[ "$("${git_command[@]}" ls-remote --exit-code "$repo" refs/heads/main | cut -f1)" == "$commit" ]] || {
  echo '构建期间 main 已更新，请发布新的提交' >&2
  exit 1
}
switch_release "$target"
activated=1
restart_app
check_release
echo "已发布 $commit"
