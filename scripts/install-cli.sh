#!/usr/bin/env bash
set -euo pipefail

# DevOps CLI (devops) 一键安装与卸载脚本。
# 支持在已克隆仓库内直接安装，或通过 curl 独立拉取源码构建后安装到用户 PATH。

REPO_URL="${DEVOPS_CLI_REPO:-https://github.com/aiShuiJiaoDeXioShou/dev-ops.git}"
REPO_REF="${DEVOPS_CLI_REF:-main}"
INSTALL_DIR="${DEVOPS_CLI_HOME:-$HOME/.local/share/dev-ops}"
BIN_DIR="${DEVOPS_CLI_BIN_DIR:-$HOME/.local/bin}"
ACTION="install"
SKIP_BUILD=0

usage() {
  cat <<'EOF'
DevOps CLI (devops) 安装脚本

用法:
  ./scripts/install-cli.sh [选项]
  curl -fsSL https://raw.githubusercontent.com/aiShuiJiaoDeXioShou/dev-ops/main/scripts/install-cli.sh | bash

选项:
  --bin-dir <目录>      可执行文件安装目录（默认: ~/.local/bin）
  --install-dir <目录>  独立安装时的源码存放目录（默认: ~/.local/share/dev-ops）
  --ref <分支或标签>    独立安装时检出的 Git 引用（默认: main）
  --repo <地址>         Git 仓库地址（默认: 官方仓库 HTTPS）
  --skip-build          在本地仓库已有构建产物时跳过依赖安装与编译
  --uninstall           卸载已安装的 devops 命令（保留独立源码目录，可手动删除）
  -h, --help            显示此帮助信息

环境变量:
  DEVOPS_CLI_BIN_DIR    等同于 --bin-dir
  DEVOPS_CLI_HOME       等同于 --install-dir
  DEVOPS_CLI_REF        等同于 --ref
  DEVOPS_CLI_REPO       等同于 --repo
EOF
}

log() {
  printf '[devops-cli] %s\n' "$*"
}

die() {
  printf '[devops-cli] 错误: %s\n' "$*" >&2
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --bin-dir)
      [[ $# -ge 2 ]] || die '--bin-dir 缺少参数'
      BIN_DIR="$2"
      shift 2
      ;;
    --install-dir)
      [[ $# -ge 2 ]] || die '--install-dir 缺少参数'
      INSTALL_DIR="$2"
      shift 2
      ;;
    --ref)
      [[ $# -ge 2 ]] || die '--ref 缺少参数'
      REPO_REF="$2"
      shift 2
      ;;
    --repo)
      [[ $# -ge 2 ]] || die '--repo 缺少参数'
      REPO_URL="$2"
      shift 2
      ;;
    --skip-build)
      SKIP_BUILD=1
      shift
      ;;
    --uninstall)
      ACTION="uninstall"
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

TARGET_BIN="$BIN_DIR/devops"

if [[ "$ACTION" == "uninstall" ]]; then
  if [[ -f "$TARGET_BIN" || -L "$TARGET_BIN" ]]; then
    rm -f "$TARGET_BIN"
    log "已移除 $TARGET_BIN"
  else
    log "未找到已安装的 $TARGET_BIN"
  fi
  if [[ -d "$INSTALL_DIR" ]]; then
    log "如需一并清理独立源码目录，请执行: rm -rf \"$INSTALL_DIR\""
  fi
  exit 0
fi

# 校验 Node.js 24 运行时，满足工作区 engines (>=24.15.0 <25) 约束。
command -v node >/dev/null 2>&1 || die '未找到 node，请先安装 Node.js 24（建议 24.15.0+）'
NODE_BIN="$(command -v node)"
NODE_VERSION="$("$NODE_BIN" -p 'process.versions.node')"
NODE_MAJOR="${NODE_VERSION%%.*}"
NODE_REST="${NODE_VERSION#*.}"
NODE_MINOR="${NODE_REST%%.*}"
if [[ "$NODE_MAJOR" -ne 24 || "$NODE_MINOR" -lt 15 ]]; then
  die "当前 Node.js 版本为 v${NODE_VERSION}，需要 >=24.15.0 且 <25（可执行 nvm use）"
fi

# 优先使用已安装的 pnpm，缺失时尝试通过 corepack 启用。
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
  die '未找到 pnpm 或 corepack，请先安装 pnpm 11（corepack enable pnpm）'
}

# 判断当前脚本或当前目录是否位于 dev-ops 仓库内，避免重复克隆。
detect_local_repo() {
  local candidate=""
  if [[ -n "${BASH_SOURCE[0]:-}" && -f "${BASH_SOURCE[0]}" ]]; then
    local script_dir
    script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    candidate="$(cd "$script_dir/.." && pwd)"
    if [[ -f "$candidate/apps/cli/package.json" && -f "$candidate/pnpm-workspace.yaml" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  fi
  if [[ -f "$PWD/apps/cli/package.json" && -f "$PWD/pnpm-workspace.yaml" ]]; then
    printf '%s\n' "$PWD"
    return 0
  fi
  return 1
}

WORKSPACE_DIR=""
if WORKSPACE_DIR="$(detect_local_repo)"; then
  log "检测到本地工作区: $WORKSPACE_DIR"
else
  command -v git >/dev/null 2>&1 || die '未找到 git，独立安装需要 git 克隆仓库'
  WORKSPACE_DIR="$INSTALL_DIR"
  if [[ -d "$WORKSPACE_DIR/.git" ]]; then
    log "更新本地源码目录: $WORKSPACE_DIR ($REPO_REF)"
    git -C "$WORKSPACE_DIR" fetch --depth 1 origin "$REPO_REF"
    git -C "$WORKSPACE_DIR" checkout -q FETCH_HEAD
  else
    log "克隆仓库到 $WORKSPACE_DIR ($REPO_REF)"
    mkdir -p "$(dirname "$WORKSPACE_DIR")"
    git clone --depth 1 --branch "$REPO_REF" "$REPO_URL" "$WORKSPACE_DIR"
  fi
fi

# 契约导出前需要初始化 packages/devops-bot 子模块。
if [[ "$SKIP_BUILD" -eq 0 ]]; then
  resolve_pnpm
  if [[ ! -f "$WORKSPACE_DIR/packages/devops-bot/package.json" ]]; then
    command -v git >/dev/null 2>&1 || die '缺少 packages/devops-bot 子模块且未找到 git'
    log '初始化 packages/devops-bot 子模块...'
    git -C "$WORKSPACE_DIR" submodule update --init --recursive
  fi

  log '安装依赖并构建 API 客户端与 CLI...'
  (
    cd "$WORKSPACE_DIR"
    "${PNPM_CMD[@]}" install --frozen-lockfile
    "${PNPM_CMD[@]}" prepare:clients
    "${PNPM_CMD[@]}" --filter @dev-ops/cli build
  )
fi

CLI_ENTRY="$WORKSPACE_DIR/apps/cli/dist/index.js"
[[ -f "$CLI_ENTRY" ]] || die "未找到构建产物: ${CLI_ENTRY}（请去掉 --skip-build 重试）"
chmod +x "$CLI_ENTRY"

# 使用包装脚本固定 Node 24 路径，避免切换目录或默认 Node 版本变化导致运行失败。
mkdir -p "$BIN_DIR"
cat > "$TARGET_BIN" <<EOF
#!/usr/bin/env bash
set -euo pipefail
NODE_BIN="$NODE_BIN"
if [[ ! -x "\$NODE_BIN" ]]; then
  NODE_BIN="\$(command -v node)"
fi
exec "\$NODE_BIN" "$CLI_ENTRY" "\$@"
EOF
chmod 0755 "$TARGET_BIN"

VERSION_OUT="$("$TARGET_BIN" --version)"
log "安装完成: $TARGET_BIN (version $VERSION_OUT)"

case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *)
    printf '\n'
    log "注意: $BIN_DIR 当前不在 PATH 中，请将下面这行加入 ~/.zshrc 或 ~/.bashrc："
    printf '  export PATH="%s:$PATH"\n' "$BIN_DIR"
    ;;
esac

cat <<'EOF'

下一步（在 Web 个人设置 /settings/profile 创建 API Token 后执行）:
  devops config set server https://your-devops.example.com
  devops config set token
  devops whoami
EOF
