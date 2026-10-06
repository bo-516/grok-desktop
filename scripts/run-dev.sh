#!/usr/bin/env bash
# One-shot launcher: Go bridge + UI (web|desktop).
#
# Usage:
#   ./scripts/run-dev.sh                 # interactive menu
#   ./scripts/run-dev.sh bridge          # Go bridge only (foreground)
#   ./scripts/run-dev.sh go-web          # 1) Go bridge + Vite web
#   ./scripts/run-dev.sh go-desktop      # 2) Go bridge + Wails shell
#   ./scripts/run-dev.sh go-both         # 3) Go: Vite web + Wails desktop
#   ./scripts/run-dev.sh 1|2|3           # same as web / desktop / both
#
# node-web, node-desktop, node-both, and menu numbers 4–6 exit 1.
# The Node bridge process has been removed.
#
# Env overrides:
#   BRIDGE_CWD          workspace for agent (default: <repo> in this script)
#   BRIDGE_PORT         fixed port for web mode (default: free / 8765)
#   VITE_PORT           Vite port (default: 8172)
#   SKIP_BUILD=1        do not rebuild stale go/shell/desktop artifacts
#
# Desktop mode auto-increments:
#   apps/desktop src → Vite dist → shell/frontend/dist → go:embed shell bin
# so TS/UI edits are not silently stuck on an old embedded bundle.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Dev default: the checkout itself. Production packaged runs use <Documents>/Grok
# (see apps/bridge-go/internal/session/default_workspace.go). demo/ stays for m0:live.
BRIDGE_CWD="${BRIDGE_CWD:-$ROOT}"
VITE_PORT="${VITE_PORT:-8172}"
GO_BRIDGE_BIN="$ROOT/apps/bridge-go/bin/bridge-go"
SHELL_BIN="$ROOT/apps/shell/bin/grok-desktop"

# PIDs we own. Desktop-only uses exec (no SHELL_PID). Both-mode tracks both UIs.
# Desktop shell always owns its own bridge (separate port/token from the web bridge).
BRIDGE_PID=""
WEB_PID=""
SHELL_PID=""

log() { printf '\033[1;34m[run-dev]\033[0m %s\n' "$*"; }
err() { printf '\033[1;31m[run-dev]\033[0m %s\n' "$*" >&2; }

# Stop the process whose pid is stored in the variable named by $1 (no-op if empty / dead).
stop_pid() {
  local pid="${!1:-}"
  if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
  fi
}

cleanup() {
  local code=$?
  # Web Vite, then its bridge group, then Wails (shell kills its own bridge).
  stop_pid WEB_PID
  if [[ -n "${BRIDGE_PID}" ]] && kill -0 "$BRIDGE_PID" 2>/dev/null; then
    # Prefer process-group kill when bridge was launched with setsid.
    kill -- "-$BRIDGE_PID" 2>/dev/null || kill "$BRIDGE_PID" 2>/dev/null || true
    wait "$BRIDGE_PID" 2>/dev/null || true
  fi
  stop_pid SHELL_PID
  exit "$code"
}
trap cleanup EXIT INT TERM

# Rebuild / port helpers (need_cmd, ensure_*, pick_port).
# shellcheck source=scripts/run-dev-build.sh
. "$ROOT/scripts/run-dev-build.sh"

# Start the Go bridge; set BRIDGE_WS_URL globally after ready.
# Missing `go` or a failed build exits 1. There is no Node fallback.
start_bridge() {
  local port token ready_line log_file
  port="$(pick_port)"
  token="$(openssl rand -hex 16 2>/dev/null || python3 -c 'import secrets; print(secrets.token_hex(16))')"
  log_file="$(mktemp -t grok-bridge.XXXXXX.log)"

  export BRIDGE_PORT="$port"
  export BRIDGE_TOKEN="$token"
  export BRIDGE_HOST="127.0.0.1"
  export BRIDGE_CWD
  export BRIDGE_ALLOWED_ORIGINS="http://localhost:${VITE_PORT},http://127.0.0.1:${VITE_PORT},http://localhost:5173,http://127.0.0.1:5173,null,file://"

  ensure_go_bridge
  log "starting Go bridge on :$port …"
  # setsid so cleanup can kill the whole group (agent children).
  if command -v setsid >/dev/null 2>&1; then
    setsid "$GO_BRIDGE_BIN" >"$log_file" 2>&1 &
  else
    "$GO_BRIDGE_BIN" >"$log_file" 2>&1 &
  fi
  BRIDGE_PID=$!

  # Wait for machine-readable ready line (token/port).
  local i
  for i in $(seq 1 50); do
    if ! kill -0 "$BRIDGE_PID" 2>/dev/null; then
      err "bridge exited early — log:"
      cat "$log_file" >&2 || true
      exit 1
    fi
    if ready_line="$(grep -E '\[bridge\] ready ' "$log_file" 2>/dev/null | tail -1)"; then
      if [[ -n "$ready_line" ]]; then
        break
      fi
    fi
    sleep 0.1
    ready_line=""
  done
  if [[ -z "${ready_line:-}" ]]; then
    err "bridge ready timeout — log:"
    cat "$log_file" >&2 || true
    exit 1
  fi

  # Prefer parsed port/token from ready JSON if present.
  if command -v python3 >/dev/null 2>&1; then
    local parsed
    parsed="$(python3 - <<PY
import json,re,sys
line = """$ready_line"""
m = re.search(r"\\[bridge\\] ready (\\{.*\\})", line)
if not m:
    sys.exit(1)
j = json.loads(m.group(1))
print(j.get("port", ""), j.get("token", ""))
PY
)" || true
    if [[ -n "${parsed:-}" ]]; then
      # shellcheck disable=SC2086
      set -- $parsed
      port="${1:-$port}"
      token="${2:-$token}"
    fi
  fi

  BRIDGE_WS_URL="ws://127.0.0.1:${port}?token=${token}"
  export BRIDGE_WS_URL
  log "bridge ready impl=go ws=$BRIDGE_WS_URL"
  log "bridge log: $log_file"
}

# Start Vite against the script-owned bridge. Sets WEB_PID; does not wait
# (caller waits so both-mode can also watch the Wails shell).
start_web() {
  log "starting Vite UI on http://127.0.0.1:${VITE_PORT} …"
  log "  VITE_BRIDGE_URL=$BRIDGE_WS_URL"
  (
    cd "$ROOT"
    export VITE_BRIDGE_URL="$BRIDGE_WS_URL"
    # Also expose token separately for defaultBridgeUrl() fallback.
    export VITE_BRIDGE_TOKEN="${BRIDGE_TOKEN:-}"
    npm run dev -w @grok-desktop/desktop -- --host 127.0.0.1 --port "$VITE_PORT" --strictPort
  ) &
  WEB_PID=$!
  log "web PID=$WEB_PID — open http://127.0.0.1:${VITE_PORT}"
}

# Start the Wails shell. It spawns its own bridge-go (random port/token).
# Desktop-only: exec (replace this script). Both-mode: DESKTOP_BG=1 backgrounds
# into SHELL_PID so Vite can run alongside.
# Forces GROK_DESKTOP_BRIDGE=go so a leftover `=node` in the environment
# does not fail this launcher. A direct shell start still rejects `node`.
start_desktop() {
  ensure_shell
  ensure_go_bridge
  log "starting Wails shell with GROK_DESKTOP_BRIDGE=go …"
  log "  (shell spawns its own bridge with random port/token)"
  export GROK_DESKTOP_BRIDGE=go
  export BRIDGE_CWD
  # Shell discovers monorepo from cwd / executable path.
  if [[ "${DESKTOP_BG:-0}" == "1" ]]; then
    "$SHELL_BIN" &
    SHELL_PID=$!
    log "desktop PID=$SHELL_PID"
    return
  fi
  exec "$SHELL_BIN"
}

# Block until Vite or the Wails shell exits; cleanup then tears down the rest.
# Polls because macOS /bin/bash is 3.2 (no `wait -n`).
wait_ui_children() {
  while true; do
    if [[ -n "${WEB_PID}" ]] && ! kill -0 "$WEB_PID" 2>/dev/null; then
      log "web exited"
      return 0
    fi
    if [[ -n "${SHELL_PID}" ]] && ! kill -0 "$SHELL_PID" 2>/dev/null; then
      log "desktop exited"
      return 0
    fi
    sleep 0.3
  done
}

# Shared web+desktop stack: Vite (script-owned bridge) + Wails (its own bridge).
# Two bridges on purpose — desktop always injects its own WS URL.
start_both() {
  start_bridge
  start_web
  DESKTOP_BG=1
  start_desktop
  log "both running — web http://127.0.0.1:${VITE_PORT} + Wails desktop"
  wait_ui_children
}

# Foreground Go bridge. exec replaces this script so the ready line stays attached.
run_bridge_only() {
  ensure_go_bridge
  exec "$GO_BRIDGE_BIN"
}

print_menu() {
  cat <<'EOF'

  Grok Desktop — run combinations

    1) bridge + web      (Vite browser)
    2) bridge + desktop  (Wails shell)
    3) bridge + both     (Vite + Wails)
    q) quit

EOF
}

# node_removed_sentence is printed for leftover Node launcher names.
node_removed_sentence() {
  echo "node bridge was removed; use: go-web | go-desktop | go-both"
}

resolve_choice() {
  case "${1:-}" in
    1 | go-web | go_web | goweb) echo go-web ;;
    2 | go-desktop | go_desktop | godesktop) echo go-desktop ;;
    3 | go-both | go_both | goboth | both | all) echo go-both ;;
    bridge) echo bridge ;;
    node-web | node_web | nodeweb | node-desktop | node_desktop | nodedesktop | node-both | node_both | nodeboth | 4 | 5 | 6)
      echo removed
      ;;
    q | quit | exit) echo quit ;;
    *) echo "" ;;
  esac
}

run_mode() {
  case "$1" in
    go-web)
      start_bridge
      start_web
      wait "$WEB_PID"
      ;;
    go-desktop)
      start_desktop
      ;;
    go-both)
      start_both
      ;;
    bridge)
      run_bridge_only
      ;;
    removed)
      err "$(node_removed_sentence)"
      exit 1
      ;;
    quit)
      exit 0
      ;;
    *)
      err "unknown mode: $1"
      err "use: bridge | go-web | go-desktop | go-both | 1-3"
      exit 1
      ;;
  esac
}

main() {
  local choice mode
  if [[ $# -ge 1 ]]; then
    mode="$(resolve_choice "$1")"
    if [[ -z "$mode" ]]; then
      err "unknown argument: $1"
      print_menu
      exit 1
    fi
    run_mode "$mode"
    return
  fi

  if [[ ! -t 0 ]]; then
    err "no TTY and no mode argument — pass e.g. go-web or bridge"
    print_menu
    exit 1
  fi

  print_menu
  while true; do
    read -r -p "Select [1-3/q]: " choice
    mode="$(resolve_choice "$choice")"
    if [[ -z "$mode" ]]; then
      err "invalid choice: $choice"
      continue
    fi
    run_mode "$mode"
    return
  done
}

main "$@"
