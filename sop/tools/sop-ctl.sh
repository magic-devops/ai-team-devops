#!/usr/bin/env bash
# sop-ctl.sh — SOP 统一管控入口（不依赖 pip 安装的 sop-cli；与 `sop` Typer CLI 互补）
#
# 全局参数（须写在子命令之前）:
#   -y, --yes          reinit 时自动追加 -y（非交互）
#   --json             status / env / version / wait-health / self-check 输出 JSON（需 python3）
#   --project-path=DIR  或  --project-path DIR   被管理项目根（默认当前目录）
#   --port=N  或  --port N                Manager 端口（默认 8765）
#
# 子命令:
#   help init reinit backup clean start start-bg restart-bg stop-bg stop status health
#   install repair deploy register doctor sync reset-admin manager bootstrap
#   complete version env logs url open wait-health self-check commands
#
# 用法示例:
#   bash sop/tools/sop-ctl.sh --project-path /path/to/app --port 9000 start
#   bash sop/tools/sop-ctl.sh -y reinit my-proj
#   bash sop/tools/sop-ctl.sh --json status | jq .
#   bash sop/tools/sop-ctl.sh wait-health --timeout 120
#   bash sop/tools/sop-ctl.sh complete bash   # 输出可 source 的补全片段
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
WEB_DIR="$REPO_ROOT/sop/web"
SOP_CTL_AUTO_YES=0
SOP_CTL_JSON=0

log() { printf '%s\n' "$*"; }
warn() { printf '⚠️  %s\n' "$*" >&2; }
die() { printf '❌ %s\n' "$*" >&2; exit 1; }

usage() {
  # 仅打印文件头注释块（不含 set -euo）
  sed -n '2,21p' "$0" | sed 's/^# \{0,1\}//'
  cat <<'EOF'

子命令一览:
  help              本帮助
  init <名>         调用 init-ai-project.sh init
  reinit [选项] [名]  调用 init-ai-project.sh reinit（全局 -y 时自动注入 -y）
  backup [--full]   LanceDB 快照；--full 再打 tgz 到 .sop-backups/
  clean [--apply]   清理遗留 sop/web/sop.db 等
  start […]         前台启动 Manager（参数透传 start-manager.sh）
  start-bg [--port N] [--no-reload]   后台启动，PID 写入 .sop-runtime/manager.pid
  restart-bg […]    stop-bg --force 后 start-bg
  stop-bg|stop [--force]  结束后台 Manager（无 PID 时 --force 不报错）
  status            PID 文件 + /api/health（配合 --json 输出一行 JSON）
  health […]        health-check.sh
  install […]       install-integrations.sh
  repair [--strict]   install + health（--strict 时 install 失败即退出）
  deploy single|saas  打印 docker compose 示例
  register            systemd 单元模板（stdout）
  doctor              sop doctor 或降级 health-check
  sync                sync-rules.sh（同步规约到 AGENTS 等）
  reset-admin […]     python3 reset-admin.py
  manager […]         python3 manager_client.py（需在仓库根或设 MANAGER_URL 等）
  bootstrap […]       bootstrap-dev.sh
  complete bash|zsh   输出补全安装片段（zsh 为说明 + 指向 bash）
  version             版本与 git 描述
  env                 打印当前生效的 PROJECT_PATH / PORT 等
  logs [-f|--follow] [行数]   tail 后台日志（默认 80 行；-f 持续跟踪）
  url                 打印本机 Manager 根 URL 与 /api/health 地址
  open                在浏览器打开 Manager 根 URL（macOS open / Linux xdg-open）
  wait-health [--timeout SEC]   轮询 /api/health 直至就绪或超时（默认 60s）
  self-check          bash -n 自检脚本 + 检查补全文件存在
  commands            输出子命令列表（每行一条，便于脚本）

自动补全:
  alias sopctl='bash REPO/sop/tools/sop-ctl.sh'
  eval "$(bash REPO/sop/tools/sop-ctl.sh complete bash)"
EOF
}

# ── 解析全局选项（遇首个非全局参数即停止）──────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --json)
      SOP_CTL_JSON=1
      shift
      ;;
    -y|--yes)
      SOP_CTL_AUTO_YES=1
      shift
      ;;
    --project-path=*)
      export PROJECT_PATH="${1#*=}"
      shift
      ;;
    --project-path)
      [[ $# -ge 2 ]] || die "--project-path 需要目录参数"
      export PROJECT_PATH="$2"
      shift 2
      ;;
    --port=*)
      export PORT="${1#*=}"
      shift
      ;;
    --port)
      [[ $# -ge 2 ]] || die "--port 需要端口号"
      export PORT="$2"
      shift 2
      ;;
    -h|--help)
      if [[ $# -eq 1 ]]; then
        usage
        exit 0
      fi
      break
      ;;
    -*)
      warn "未知全局参数（将交给子命令）: $1"
      break
      ;;
    *)
      break
      ;;
  esac
done

PP="$(cd "${PROJECT_PATH:-$(pwd)}" && pwd)"
export PROJECT_PATH="$PP"
PORT="${PORT:-8765}"
export PORT
RT="$PP/.sop-runtime"
PID_FILE="$RT/manager.pid"
NOHUP_LOG="$RT/logs/manager-nohup.log"
PY="${SOP_PYTHON:-python3}"

cmd="${1:-help}"
shift || true

# reinit + 全局 -y：若子参数中尚无 -y/--yes，则注入
if [[ "$cmd" == "reinit" && "$SOP_CTL_AUTO_YES" == "1" ]]; then
  _has_y=0
  for _a in "$@"; do
    if [[ "$_a" == "-y" || "$_a" == "--yes" ]]; then _has_y=1; break; fi
  done
  if [[ $_has_y -eq 0 ]]; then
    set -- -y "$@"
  fi
fi

case "$cmd" in
  help|-h|--help)
    usage
    log ""
    log "若已 pip install -e packages/sop-cli：可用 sop init / sop doctor / sop agentd …，见 docs/USER_MANUAL.md §1.3。"
    log "脚本化/CI：可在子命令前加全局 --json（用于 status / env / version / wait-health / self-check）。"
    ;;
  init)
    exec bash "$SCRIPT_DIR/init-ai-project.sh" init "$@"
    ;;
  reinit)
    exec bash "$SCRIPT_DIR/init-ai-project.sh" reinit "$@"
    ;;
  backup)
    FULL=0
    if [[ "${1:-}" == "--full" ]]; then FULL=1; shift; fi
    export PROJECT_PATH="$PP"
    log "📦 LanceDB 快照（memory/snapshots）…"
    (cd "$PP" && bash "$SCRIPT_DIR/snapshot.sh") || true
    if [[ "$FULL" -eq 1 ]]; then
      mkdir -p "$PP/.sop-backups"
      TS="$(date +%Y%m%d_%H%M%S)"
      OUT="$PP/.sop-backups/sop-bundle-${TS}.tgz"
      log "📦 打包 memory/ 与 .sop-runtime/ → $OUT …"
      tar_args=()
      [[ -d "$PP/memory" ]] && tar_args+=(memory)
      [[ -d "$PP/.sop-runtime" ]] && tar_args+=(".sop-runtime")
      if [[ ${#tar_args[@]} -eq 0 ]]; then
        die "无 memory/ 或 .sop-runtime/ 可打包"
      fi
      tar -czf "$OUT" \
        --exclude='.venv' --exclude='node_modules' --exclude='__pycache__' \
        -C "$PP" "${tar_args[@]}" \
        || die "打包失败（确认路径可读写）"
      log "✅ $OUT"
    else
      log "ℹ️  仅向量快照已导出。完整备份: bash sop/tools/sop-ctl.sh backup --full"
    fi
    ;;
  clean)
    PROJECT_PATH="$PP" exec bash "$SCRIPT_DIR/cleanup-legacy-runtime.sh" "$@"
    ;;
  start)
    export PROJECT_PATH="$PP"
    exec bash "$SCRIPT_DIR/start-manager.sh" "$@"
    ;;
  start-bg)
    NO_RELOAD=0
    while [[ $# -gt 0 ]]; do
      case "$1" in
        --port=*) PORT="${1#*=}"; export PORT; shift ;;
        --port) PORT="${2:?}"; export PORT; shift 2 ;;
        --no-reload) NO_RELOAD=1; shift ;;
        *)
          die "start-bg 未知参数: $1（支持: --port N / --no-reload）"
          ;;
      esac
    done
    mkdir -p "$RT/logs"
    if [[ -f "$PID_FILE" ]]; then
      old="$(cat "$PID_FILE" 2>/dev/null || true)"
      if [[ -n "$old" ]] && kill -0 "$old" 2>/dev/null; then
        die "已有后台进程 PID=$old（先: bash sop/tools/sop-ctl.sh stop-bg）"
      fi
    fi
    log "🚀 后台启动 Manager（PROJECT_PATH=$PP PORT=$PORT）…"
    log "   日志: $NOHUP_LOG"
    (
      cd "$REPO_ROOT"
      if [[ "$NO_RELOAD" -eq 1 ]]; then
        nohup env PROJECT_PATH="$PP" PORT="$PORT" START_MANAGER_SKIP_BROWSER=1 START_MANAGER_NO_RELOAD=1 \
          bash "$SCRIPT_DIR/start-manager.sh" >>"$NOHUP_LOG" 2>&1 &
      else
        nohup env PROJECT_PATH="$PP" PORT="$PORT" START_MANAGER_SKIP_BROWSER=1 \
          bash "$SCRIPT_DIR/start-manager.sh" >>"$NOHUP_LOG" 2>&1 &
      fi
      echo $! >"$PID_FILE"
    )
    sleep 1
    if [[ -f "$PID_FILE" ]]; then
      log "✅ PID $(cat "$PID_FILE") 已写入 $PID_FILE"
    fi
    ;;
  restart-bg)
    export PROJECT_PATH="$PP" PORT="$PORT"
    bash "$SCRIPT_DIR/sop-ctl.sh" --project-path "$PP" --port "$PORT" stop-bg --force || true
    exec bash "$SCRIPT_DIR/sop-ctl.sh" --project-path "$PP" --port "$PORT" start-bg "$@"
    ;;
  stop-bg|stop)
    FORCE=0
    if [[ "${1:-}" == "--force" ]]; then FORCE=1; shift; fi
    if [[ ! -f "$PID_FILE" ]]; then
      [[ "$FORCE" -eq 1 ]] && exit 0 || die "无 PID 文件: $PID_FILE（未用 start-bg 启动？）"
    fi
    pid="$(cat "$PID_FILE" 2>/dev/null || true)"
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" && log "✅ 已发送 SIGTERM → $pid" || die "kill 失败"
    else
      log "ℹ️  进程 $pid 已不存在，移除 stale PID"
    fi
    rm -f "$PID_FILE"
    ;;
  status)
    pid=""
    running=0
    if [[ -f "$PID_FILE" ]]; then
      pid="$(cat "$PID_FILE" 2>/dev/null || true)"
      if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then running=1; fi
    fi
    health_ok=0
    if curl -sf "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then health_ok=1; fi

    if [[ "${SOP_CTL_JSON:-0}" == 1 ]]; then
      export SOP_JSON_PP="$PP" SOP_JSON_PORT="$PORT" SOP_JSON_PID="${pid:-}"
      export SOP_JSON_RUNNING="$running" SOP_JSON_HEALTH="$health_ok" SOP_JSON_PIDFILE="$PID_FILE"
      "$PY" <<'PY' || die "--json 需要可用的 python3"
import json, os
p = os.environ.get("SOP_JSON_PID", "").strip()
pid = int(p) if p.isdigit() else None
print(json.dumps({
    "projectPath": os.environ["SOP_JSON_PP"],
    "port": int(os.environ["SOP_JSON_PORT"]),
    "pid": pid,
    "pidRunning": bool(int(os.environ["SOP_JSON_RUNNING"])),
    "healthOk": bool(int(os.environ["SOP_JSON_HEALTH"])),
    "pidFile": os.environ["SOP_JSON_PIDFILE"],
}, ensure_ascii=False))
PY
      exit 0
    fi

    log "PROJECT_PATH=$PP PORT=$PORT"
    if [[ -f "$PID_FILE" ]]; then
      log "PID 文件: $PID_FILE → ${pid:-}"
      if [[ "$running" -eq 1 ]]; then
        log "进程: 运行中"
      else
        log "进程: 未运行（stale pid）"
      fi
    else
      log "PID 文件: 无（未使用 start-bg）"
    fi
    if [[ "$health_ok" -eq 1 ]]; then
      log "HTTP /api/health: 可达"
    else
      log "HTTP /api/health: 不可达"
    fi
    ;;
  health)
    PORT="$PORT" PROJECT_PATH="$PP" exec bash "$SCRIPT_DIR/health-check.sh" "$@"
    ;;
  install)
    exec bash "$SCRIPT_DIR/install-integrations.sh" "$@"
    ;;
  repair)
    STRICT=0
    if [[ "${1:-}" == "--strict" ]]; then STRICT=1; shift; fi
    log "🔧 repair: 安装依赖 → 健康检查"
    if [[ "$STRICT" -eq 1 ]]; then
      bash "$SCRIPT_DIR/install-integrations.sh" || die "install 失败（已指定 --strict）"
    else
      bash "$SCRIPT_DIR/install-integrations.sh" || true
    fi
    PORT="$PORT" PROJECT_PATH="$PP" bash "$SCRIPT_DIR/health-check.sh" || true
    log "✅ repair 完成（若有 FAIL 请根据 health-check 输出处理）"
    ;;
  deploy)
    mode="${1:-single}"
    case "$mode" in
      single)
        log "单机 Docker（SQLite + LanceDB）："
        log "  cd $REPO_ROOT"
        log "  SECRET_KEY=请改为强随机值 \\"
        log "  PROJECT_PATH=$PP \\"
        log "  docker compose -f apps/manager/docker-compose.single.yml up -d --build"
        ;;
      saas)
        if [[ -f "$REPO_ROOT/apps/manager/docker-compose.saas.yml" ]]; then
          log "SaaS 编排："
          log "  docker compose -f apps/manager/docker-compose.saas.yml up -d --build"
        else
          log "未找到 apps/manager/docker-compose.saas.yml，请用仓库内实际 compose 路径。"
        fi
        ;;
      *)
        die "用法: deploy single|saas"
        ;;
    esac
    ;;
  register)
    py="${SOP_PYTHON:-python3}"
    cat <<EOF
# 写入 /etc/systemd/system/sop-manager.service 前请修改:
#   User= / Group= / WorkingDirectory= / Environment=PROJECT_PATH / Environment=PORT
[Unit]
Description=SOP Web Manager (uvicorn)
After=network.target

[Service]
Type=simple
User=%i
WorkingDirectory=$WEB_DIR
Environment=PROJECT_PATH=$PP
Environment=PORT=$PORT
Environment=START_MANAGER_NO_RELOAD=1
Environment=START_MANAGER_SKIP_BROWSER=1
ExecStart=$py -m uvicorn main:app --host 0.0.0.0 --port ${PORT}
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
    log "ℹ️  以上为模板；ExecStart 建议在虚拟环境中使用绝对路径的 python。" >&2
    ;;
  doctor)
    if command -v sop >/dev/null 2>&1; then
      log "运行 sop doctor…"
      exec sop doctor
    fi
    _pp="$REPO_ROOT/packages/sop-cli:$REPO_ROOT/packages/sop-sdk-python"
    if (PYTHONPATH="$_pp${PYTHONPATH:+:$PYTHONPATH}" "$PY" -c "import sop_cli" 2>/dev/null); then
      log "运行 python -m sop_cli doctor（仓库 packages/）…"
      exec env PYTHONPATH="$_pp${PYTHONPATH:+:$PYTHONPATH}" "$PY" -m sop_cli doctor
    fi
    log "未检测到可运行的 sop-cli，降级为 health-check.sh"
    PORT="$PORT" PROJECT_PATH="$PP" bash "$SCRIPT_DIR/health-check.sh" || true
    ;;
  sync)
    exec bash "$SCRIPT_DIR/sync-rules.sh" "$PP"
    ;;
  reset-admin)
    (cd "$WEB_DIR" && exec "$PY" "$SCRIPT_DIR/reset-admin.py" "$@")
    ;;
  manager)
    exec env PYTHONPATH="${PYTHONPATH:-}" "$PY" "$SCRIPT_DIR/manager_client.py" "$@"
    ;;
  bootstrap)
    (cd "$REPO_ROOT" && exec bash "$SCRIPT_DIR/bootstrap-dev.sh" "$@")
    ;;
  complete)
    shell="${1:-bash}"
    case "$shell" in
      bash)
        cat <<EOF
# SOP sop-ctl 补全 — 加入 ~/.bashrc 或执行:
#   alias sopctl='bash $SCRIPT_DIR/sop-ctl.sh'
#   source $SCRIPT_DIR/sop-ctl.completion.bash
#
# 或一次性:
source "$SCRIPT_DIR/sop-ctl.completion.bash"
EOF
        ;;
      zsh)
        log "Zsh：可将 bash completion 包中的 bashcompinit 与 compdef 适配，或直接使用："
        log "  autoload bashcompinit; bashcompinit"
        log "  source $SCRIPT_DIR/sop-ctl.completion.bash"
        log "并设置: alias sopctl='bash $SCRIPT_DIR/sop-ctl.sh'"
        ;;
      *)
        die "用法: complete bash|zsh"
        ;;
    esac
    ;;
  version)
    _ver="1.3.0"
    _git=""
    if command -v git >/dev/null 2>&1; then
      _git="$(git -C "$REPO_ROOT" describe --tags --always --dirty 2>/dev/null || true)"
    fi
    if [[ "${SOP_CTL_JSON:-0}" == 1 ]]; then
      export SOP_JSON_VER="$_ver" SOP_JSON_GIT="$_git"
      "$PY" <<'PY' || die "--json 需要可用的 python3"
import json, os
print(json.dumps({
    "sopCtlVersion": os.environ["SOP_JSON_VER"],
    "gitDescribe": os.environ["SOP_JSON_GIT"] or None,
}, ensure_ascii=False))
PY
      exit 0
    fi
    log "sop-ctl.sh ${_ver} (bundle)"
    if [[ -n "$_git" ]]; then
      log "$_git"
    else
      log "(git describe 不可用)"
    fi
    ;;
  env)
    if [[ "${SOP_CTL_JSON:-0}" == 1 ]]; then
      export SOP_JSON_PP="$PP" SOP_JSON_PORT="$PORT" SOP_JSON_RT="${SOP_RUNTIME_DIR:-$RT}"
      export SOP_JSON_PIDF="$PID_FILE" SOP_JSON_LOG="$NOHUP_LOG" SOP_JSON_REPO="$REPO_ROOT"
      export SOP_JSON_WEB="$WEB_DIR" SOP_JSON_PY="$PY"
      "$PY" <<'PY' || die "--json 需要可用的 python3"
import json, os
print(json.dumps({
    "projectPath": os.environ["SOP_JSON_PP"],
    "port": int(os.environ["SOP_JSON_PORT"]),
    "sopRuntimeDir": os.environ["SOP_JSON_RT"],
    "pidFile": os.environ["SOP_JSON_PIDF"],
    "nohupLog": os.environ["SOP_JSON_LOG"],
    "repoRoot": os.environ["SOP_JSON_REPO"],
    "webDir": os.environ["SOP_JSON_WEB"],
    "sopPython": os.environ["SOP_JSON_PY"],
}, ensure_ascii=False))
PY
      exit 0
    fi
    log "PROJECT_PATH=$PP"
    log "PORT=$PORT"
    log "SOP_RUNTIME_DIR=${SOP_RUNTIME_DIR:-$RT}"
    log "PID_FILE=$PID_FILE"
    log "NOHUP_LOG=$NOHUP_LOG"
    log "REPO_ROOT=$REPO_ROOT"
    log "WEB_DIR=$WEB_DIR"
    log "SOP_PYTHON=$PY"
    ;;
  logs)
    FOLLOW=0
    n=80
    while [[ $# -gt 0 ]]; do
      case "$1" in
        -f|--follow) FOLLOW=1; shift ;;
        -h|--help) log "用法: logs [-f|--follow] [行数]"; exit 0 ;;
        ''|*[!0-9]*) die "logs 未知参数: ${1:-}（支持 -f / --follow 与正整数行数）" ;;
        *) n="$1"; shift ;;
      esac
    done
    if [[ ! -f "$NOHUP_LOG" ]]; then
      die "无日志文件: $NOHUP_LOG（先 start-bg 或查看前台启动终端）"
    fi
    if [[ "$FOLLOW" -eq 1 ]]; then
      tail -n "$n" -f "$NOHUP_LOG"
    else
      tail -n "$n" "$NOHUP_LOG"
    fi
    ;;
  url)
    log "http://127.0.0.1:${PORT}/"
    log "http://127.0.0.1:${PORT}/api/health"
    ;;
  open)
    _u="http://127.0.0.1:${PORT}/"
    case "$(uname -s 2>/dev/null || true)" in
      Darwin) open "$_u" && log "已请求打开: $_u" ;;
      Linux)
        if command -v xdg-open >/dev/null 2>&1; then
          xdg-open "$_u" >/dev/null 2>&1 && log "已请求打开: $_u" || warn "xdg-open 失败，请手动: $_u"
        else
          warn "未找到 xdg-open，请手动打开: $_u"
        fi
        ;;
      *) warn "请手动打开: $_u" ;;
    esac
    ;;
  wait-health)
    timeout_sec=60
    interval=1
    while [[ $# -gt 0 ]]; do
      case "$1" in
        --timeout=*) timeout_sec="${1#*=}"; shift ;;
        --timeout) [[ $# -ge 2 ]] || die "--timeout 需要秒数"; timeout_sec="$2"; shift 2 ;;
        *)
          die "wait-health 未知参数: $1（支持: --timeout SEC）"
          ;;
      esac
    done
    [[ "$timeout_sec" =~ ^[0-9]+$ ]] || die "--timeout 须为非负整数"
    elapsed=0
    while [[ "$elapsed" -lt "$timeout_sec" ]]; do
      if curl -sf "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then
        if [[ "${SOP_CTL_JSON:-0}" == 1 ]]; then
          export SOP_JSON_WAITED="$elapsed" SOP_JSON_PORT_OUT="$PORT"
          "$PY" <<'PY' || die "--json 需要可用的 python3"
import json, os
print(json.dumps({
    "ok": True,
    "waitedSec": int(os.environ["SOP_JSON_WAITED"]),
    "port": int(os.environ["SOP_JSON_PORT_OUT"]),
}, ensure_ascii=False))
PY
        else
          log "✅ /api/health 就绪（等待 ${elapsed}s / 上限 ${timeout_sec}s）"
        fi
        exit 0
      fi
      sleep "$interval"
      elapsed=$((elapsed + interval))
    done
    if [[ "${SOP_CTL_JSON:-0}" == 1 ]]; then
      export SOP_JSON_PORT_OUT="$PORT" SOP_JSON_TO="$timeout_sec"
      "$PY" <<'PY' || die "--json 需要可用的 python3"
import json, os
print(json.dumps({
    "ok": False,
    "waitedSec": int(os.environ["SOP_JSON_TO"]),
    "port": int(os.environ["SOP_JSON_PORT_OUT"]),
}, ensure_ascii=False))
PY
      exit 1
    fi
    die "超时 ${timeout_sec}s：http://127.0.0.1:${PORT}/api/health 仍不可达"
    ;;
  self-check)
    bash -n "$SCRIPT_DIR/sop-ctl.sh" || die "bash -n sop-ctl.sh 失败"
    [[ -f "$SCRIPT_DIR/sop-ctl.completion.bash" ]] || die "缺少 sop/tools/sop-ctl.completion.bash"
    if [[ "${SOP_CTL_JSON:-0}" == 1 ]]; then
      "$PY" <<'PY' || die "--json 需要可用的 python3"
import json
print(json.dumps({"ok": True, "checks": ["bash -n sop-ctl.sh", "completion file exists"]}, ensure_ascii=False))
PY
    else
      log "✅ self-check OK（sop-ctl.sh + sop-ctl.completion.bash）"
    fi
    ;;
  commands)
    printf '%s\n' \
      help init reinit backup clean start start-bg restart-bg stop-bg stop \
      status health install repair deploy register doctor sync reset-admin manager bootstrap \
      complete version env logs url open wait-health self-check commands
    ;;
  *)
    die "未知子命令: $cmd（试试: bash sop/tools/sop-ctl.sh help）"
    ;;
esac
