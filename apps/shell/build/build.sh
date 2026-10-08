#!/usr/bin/env bash
# Build the grok-desktop Wails shell binary (macOS arm64/x64 and others via GOOS/GOARCH).
# Prerequisites: Go 1.25+, CGO for Wails webview, frontend dist synced.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SHELL_DIR="$ROOT/apps/shell"
cd "$SHELL_DIR"

if [[ ! -f frontend/dist/index.html ]]; then
  bash "$SHELL_DIR/build/sync-frontend.sh"
fi

mkdir -p bin
# CGO required on darwin for WKWebView.
export CGO_ENABLED="${CGO_ENABLED:-1}"
# Same source of truth as scripts/build-release.sh: repo root package.json.
# VERSION overrides it. The UI build reads the same value via Vite.
VERSION="${VERSION:-$(node -p "require('$ROOT/package.json').version")}"
go build -ldflags "-X main.appVersion=${VERSION}" -o bin/grok-desktop .
echo "built: $SHELL_DIR/bin/grok-desktop"
file bin/grok-desktop || true
