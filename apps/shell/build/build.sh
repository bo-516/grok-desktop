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
go build -o bin/grok-desktop .
echo "built: $SHELL_DIR/bin/grok-desktop"
file bin/grok-desktop || true
