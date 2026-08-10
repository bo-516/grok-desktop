#!/usr/bin/env bash
# One-shot launcher: bridge (node|go) + UI (web|desktop).
#
# Usage:
#   ./scripts/run-dev.sh                 # interactive menu
#   ./scripts/run-dev.sh go-web          # 1) Go bridge + Vite web
#   ./scripts/run-dev.sh node-web        # 2) Node bridge + Vite web
#   ./scripts/run-dev.sh go-desktop      # 3) Go bridge + Wails shell
#   ./scripts/run-dev.sh node-desktop    # 4) Node bridge + Wails shell
#   ./scripts/run-dev.sh 1|2|3|4        # same as above
#
# Env overrides:
#   BRIDGE_CWD          workspace for agent (default: <repo>/demo)
#   BRIDGE_PORT         fixed port for web mode (default: free / 8765)
#   VITE_PORT           Vite port (default: 8172)
#   SKIP_BUILD=1        do not rebuild missing go/shell binaries

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

BRIDGE_CWD="${BRIDGE_CWD:-$ROOT/demo}"
VITE_PORT="${VITE_PORT:-8172}"
NODE_BRIDGE_SRC="$ROOT/apps/bridge/src/server.ts"
GO_BRIDGE_BIN="$ROOT/apps/bridge-go/bin/bridge-go"
SHELL_BIN="$ROOT/apps/shell/bin/grok-desktop"
TSX_BIN="$ROOT/node_modules/.bin/tsx"

# PIDs we own in web mode (desktop shell owns its own bridge).
BRIDGE_PID=""
WEB_PID=""

log() { printf '\033[1;34m[run-dev]\033[0m %s\n' "$*"; }
err() { printf '\033[1;31m[run-dev]\033[0m %s\n' "$*" >&2; }

cleanup() {
  local code=$?
  # Kill process groups we started (web mode only).
  if [[ -n "${WEB_PID}" ]] && kill -0 "$WEB_PID" 2>/dev/null; then
    kill "$WEB_PID" 2>/dev/null || true
    wait "$WEB_PID" 2>/dev/null || true
  fi
  if [[ -n "${BRIDGE_PID}" ]] && kill -0 "$BRIDGE_PID" 2>/dev/null; then
    # Prefer process-group kill when bridge was launched with setsid.
    kill -- "-$BRIDGE_PID" 2>/dev/null || kill "$BRIDGE_PID" 2>/dev/null || true
    wait "$BRIDGE_PID" 2>/dev/null || true
  fi
  exit "$code"
}
trap cleanup EXIT INT TERM

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    err "missing command: $1"
    exit 1
  }
}

ensure_tsx() {
  if [[ -x "$TSX_BIN" ]]; then
    return 0
  fi
  if command -v tsx >/dev/null 2>&1; then
    TSX_BIN="$(command -v tsx)"
    return 0
  fi
  err "tsx not found — run: npm install"
  exit 1
}

ensure_go_bridge() {
  if [[ -x "$GO_BRIDGE_BIN" ]]; then
    return 0
  fi
  if [[ "${SKIP_BUILD:-0}" == "1" ]]; then
    err "Go bridge binary missing: $GO_BRIDGE_BIN (SKIP_BUILD=1)"
    exit 1
  fi
  need_cmd go
  log "building Go bridge → $GO_BRIDGE_BIN"
  mkdir -p "$(dirname "$GO_BRIDGE_BIN")"
  (cd "$ROOT/apps/bridge-go" && go build -o bin/bridge-go ./cmd/bridge)
}

ensure_shell() {
  if [[ -x "$SHELL_BIN" ]]; then
    return 0
  fi
  if [[ "${SKIP_BUILD:-0}" == "1" ]]; then
    err "shell binary missing: $SHELL_BIN (SKIP_BUILD=1)"
    exit 1
  fi
  need_cmd go
  log "building Wails shell → $SHELL_BIN"
  if [[ ! -f "$ROOT/apps/shell/frontend/dist/index.html" ]]; then
    log "syncing desktop dist into shell embed…"
    if [[ -f "$ROOT/apps/shell/build/sync-frontend.sh" ]]; then
      bash "$ROOT/apps/shell/build/sync-frontend.sh"
    elif [[ -d "$ROOT/apps/desktop/dist" ]]; then
      mkdir -p "$ROOT/apps/shell/frontend/dist"
      cp -R "$ROOT/apps/desktop/dist/." "$ROOT/apps/shell/frontend/dist/"
    else
      log "building desktop UI first…"
      npm run build -w @grok-desktop/desktop
      mkdir -p "$ROOT/apps/shell/frontend/dist"
      cp -R "$ROOT/apps/desktop/dist/." "$ROOT/apps/shell/frontend/dist/"
    fi
  fi
  mkdir -p "$(dirname "$SHELL_BIN")"
  (cd "$ROOT/apps/shell" && go build -o bin/grok-desktop .)
}

# Pick a free loopback port (or honor BRIDGE_PORT).
pick_port() {
  if [[ -n "${BRIDGE_PORT:-}" ]]; then
    echo "$BRIDGE_PORT"
    return
  fi
  # Prefer python for portability; fall back to 8765.
  if command -v python3 >/dev/null 2>&1; then
    python3 - <<'PY'
import socket
s = socket.socket()
s.bind(("127.0.0.1", 0))
print(s.getsockname()[1])
s.close()
PY
    return
  fi
  echo 8765
}

# Start Node or Go bridge; set BRIDGE_WS_URL globally after ready.
# $1 = node|go
start_bridge() {
  local impl="$1"
  local port token ready_line log_file
  port="$(pick_port)"
  token="$(openssl rand -hex 16 2>/dev/null || python3 -c 'import secrets; print(secrets.token_hex(16))')"
  log_file="$(mktemp -t grok-bridge.XXXXXX.log)"

  export BRIDGE_PORT="$port"
  export BRIDGE_TOKEN="$token"
  export BRIDGE_HOST="127.0.0.1"
  export BRIDGE_CWD
  export BRIDGE_ALLOWED_ORIGINS="http://localhost:${VITE_PORT},http://127.0.0.1:${VITE_PORT},http://localhost:5173,http://127.0.0.1:5173,null,file://"

  if [[ "$impl" == "go" ]]; then
    ensure_go_bridge
    log "starting Go bridge on :$port …"
    # setsid so cleanup can kill the whole group (agent children).
    if command -v setsid >/dev/null 2>&1; then
      setsid "$GO_BRIDGE_BIN" >"$log_file" 2>&1 &
    else
      "$GO_BRIDGE_BIN" >"$log_file" 2>&1 &
    fi
    BRIDGE_PID=$!
  else
    ensure_tsx
    log "starting Node bridge on :$port …"
    if command -v setsid >/dev/null 2>&1; then
      setsid "$TSX_BIN" "$NODE_BRIDGE_SRC" >"$log_file" 2>&1 &
    else
      "$TSX_BIN" "$NODE_BRIDGE_SRC" >"$log_file" 2>&1 &
    fi
    BRIDGE_PID=$!
  fi

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
  log "bridge ready impl=$impl ws=$BRIDGE_WS_URL"
  log "bridge log: $log_file"
}

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
  wait "$WEB_PID"
}

start_desktop() {
  local impl="$1"
  ensure_shell
  if [[ "$impl" == "go" ]]; then
    ensure_go_bridge
  fi
  log "starting Wails shell with GROK_DESKTOP_BRIDGE=$impl …"
  log "  (shell spawns its own bridge with random port/token)"
  export GROK_DESKTOP_BRIDGE="$impl"
  export BRIDGE_CWD
  # Shell discovers monorepo from cwd / executable path.
  exec "$SHELL_BIN"
}

print_menu() {
  cat <<'EOF'

  Grok Desktop — run combinations

    1) bridge (go)   + web     (Vite browser)
    2) bridge (node) + web     (Vite browser)
    3) bridge (go)   + desktop (Wails shell)
    4) bridge (node) + desktop (Wails shell)
    q) quit

EOF
}

resolve_choice() {
  case "${1:-}" in
    1 | go-web | go_web | goweb) echo go-web ;;
    2 | node-web | node_web | nodeweb) echo node-web ;;
    3 | go-desktop | go_desktop | godesktop) echo go-desktop ;;
    4 | node-desktop | node_desktop | nodedesktop) echo node-desktop ;;
    q | quit | exit) echo quit ;;
    *) echo "" ;;
  esac
}

run_mode() {
  case "$1" in
    go-web)
      start_bridge go
      start_web
      ;;
    node-web)
      start_bridge node
      start_web
      ;;
    go-desktop)
      start_desktop go
      ;;
    node-desktop)
      start_desktop node
      ;;
    quit)
      exit 0
      ;;
    *)
      err "unknown mode: $1"
      err "use: go-web | node-web | go-desktop | node-desktop | 1|2|3|4"
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
    err "no TTY and no mode argument — pass e.g. go-web"
    print_menu
    exit 1
  fi

  print_menu
  while true; do
    read -r -p "Select [1-4/q]: " choice
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
