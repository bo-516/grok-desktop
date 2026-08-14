# Sourced by run-dev.sh. Rebuild helpers for go-bridge / desktop dist / Wails shell.
# Expects: ROOT, GO_BRIDGE_BIN, SHELL_BIN, TSX_BIN (ensure_tsx may reassign), log, err.
# SKIP_BUILD=1 skips rebuilds and fails if artifacts are missing or stale.

# Exit 1 when $1 is not on PATH (used before go / other toolchain calls).
need_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    err "missing command: $1"
    exit 1
  }
}

# Resolve TSX_BIN to the workspace or PATH tsx; exit 1 if neither exists.
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

# True when $1 is missing/non-executable, or any Go source under $2 is newer than $1.
needs_rebuild() {
  local bin="$1"
  local src_dir="$2"
  if [[ ! -x "$bin" ]]; then
    return 0
  fi
  if find "$src_dir" \( -name '*.go' -o -name 'go.mod' -o -name 'go.sum' \) \
    -newer "$bin" -print -quit 2>/dev/null | grep -q .; then
    return 0
  fi
  return 1
}

# True when desktop UI sources are newer than dist/index.html (or dist is missing).
# Ignores node_modules / dist so incremental checks stay cheap.
desktop_dist_stale() {
  local dist_index="$ROOT/apps/desktop/dist/index.html"
  local src_root="$ROOT/apps/desktop"
  if [[ ! -f "$dist_index" ]]; then
    return 0
  fi
  # Config / entry at package root.
  local f
  for f in \
    "$src_root/package.json" \
    "$src_root/vite.config.ts" \
    "$src_root/vite.config.js" \
    "$src_root/index.html" \
    "$src_root/uno.config.ts" \
    "$src_root/uno.config.js" \
    "$src_root/tsconfig.json"; do
    if [[ -f "$f" && "$f" -nt "$dist_index" ]]; then
      return 0
    fi
  done
  # Application sources (prune heavy trees).
  if find "$src_root" \
    \( -path "$src_root/node_modules" -o -path "$src_root/dist" -o -path "$src_root/test" \) -prune -o \
    -type f \( \
      -name '*.ts' -o -name '*.tsx' -o -name '*.css' -o -name '*.json' \
      -o -name '*.html' -o -name '*.svg' \
    \) -newer "$dist_index" -print -quit 2>/dev/null | grep -q .; then
    return 0
  fi
  return 1
}

# Build apps/bridge-go/bin/bridge-go when missing or Go sources are newer.
ensure_go_bridge() {
  if ! needs_rebuild "$GO_BRIDGE_BIN" "$ROOT/apps/bridge-go"; then
    return 0
  fi
  if [[ "${SKIP_BUILD:-0}" == "1" ]]; then
    err "Go bridge binary missing or stale: $GO_BRIDGE_BIN (SKIP_BUILD=1)"
    exit 1
  fi
  need_cmd go
  log "building Go bridge → $GO_BRIDGE_BIN"
  mkdir -p "$(dirname "$GO_BRIDGE_BIN")"
  (cd "$ROOT/apps/bridge-go" && go build -o bin/bridge-go ./cmd/bridge)
}

# Rebuild apps/desktop/dist when UI source is newer (or dist missing).
# Wails embeds a static copy — without this, "dev" desktop silently runs stale JS.
ensure_desktop_dist() {
  if ! desktop_dist_stale; then
    return 0
  fi
  if [[ "${SKIP_BUILD:-0}" == "1" ]]; then
    err "desktop dist missing or stale (SKIP_BUILD=1) — run: npm run build -w @grok-desktop/desktop"
    exit 1
  fi
  log "building desktop UI → apps/desktop/dist (source newer than dist or dist missing)"
  npm run build -w @grok-desktop/desktop
}

# Copy desktop dist into shell embed tree when missing or older than desktop dist.
ensure_shell_frontend_sync() {
  local src_index="$ROOT/apps/desktop/dist/index.html"
  local dst_index="$ROOT/apps/shell/frontend/dist/index.html"
  if [[ ! -f "$src_index" ]]; then
    err "desktop dist missing after ensure_desktop_dist — abort"
    exit 1
  fi
  if [[ -f "$dst_index" ]] && ! find "$ROOT/apps/desktop/dist" -type f \
    -newer "$dst_index" -print -quit 2>/dev/null | grep -q .; then
    return 0
  fi
  if [[ "${SKIP_BUILD:-0}" == "1" ]]; then
    err "shell frontend embed stale (SKIP_BUILD=1) — run: bash apps/shell/build/sync-frontend.sh"
    exit 1
  fi
  log "syncing desktop dist → apps/shell/frontend/dist (go:embed input)"
  if [[ -f "$ROOT/apps/shell/build/sync-frontend.sh" ]]; then
    bash "$ROOT/apps/shell/build/sync-frontend.sh"
  else
    rm -rf "$ROOT/apps/shell/frontend/dist"
    mkdir -p "$ROOT/apps/shell/frontend/dist"
    cp -R "$ROOT/apps/desktop/dist/." "$ROOT/apps/shell/frontend/dist/"
  fi
}

# Rebuild the Wails binary when shell Go, embed dist, or desktop UI is stale.
# Dev desktop path: UI source → Vite dist → shell embed → go:embed binary.
ensure_shell() {
  ensure_desktop_dist
  ensure_shell_frontend_sync

  local need_shell=0
  if [[ ! -x "$SHELL_BIN" ]]; then
    need_shell=1
  elif find "$ROOT/apps/shell" \( -name '*.go' -o -name 'go.mod' -o -name 'go.sum' \) \
    -not -path '*/frontend/*' -not -path '*/bin/*' \
    -newer "$SHELL_BIN" -print -quit 2>/dev/null | grep -q .; then
    need_shell=1
  elif find "$ROOT/apps/shell/frontend/dist" -type f \
    -newer "$SHELL_BIN" -print -quit 2>/dev/null | grep -q .; then
    # go:embed freezes dist at compile time — any newer asset requires relink.
    need_shell=1
  fi

  if [[ "$need_shell" -eq 0 ]]; then
    return 0
  fi
  if [[ "${SKIP_BUILD:-0}" == "1" ]]; then
    err "shell binary missing or stale: $SHELL_BIN (SKIP_BUILD=1)"
    exit 1
  fi
  need_cmd go
  log "building Wails shell → $SHELL_BIN"
  mkdir -p "$(dirname "$SHELL_BIN")"
  (cd "$ROOT/apps/shell" && go build -o bin/grok-desktop .)
}

# Print a free loopback port, or BRIDGE_PORT when the caller already set one.
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
