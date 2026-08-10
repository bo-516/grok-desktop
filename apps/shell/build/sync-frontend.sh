#!/usr/bin/env bash
# Copy apps/desktop Vite dist into apps/shell/frontend/dist for go:embed.
# Run after: npm run build -w @grok-desktop/desktop
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SRC="$ROOT/apps/desktop/dist"
DST="$ROOT/apps/shell/frontend/dist"
if [[ ! -f "$SRC/index.html" ]]; then
  echo "error: $SRC/index.html missing — run: npm run build -w @grok-desktop/desktop" >&2
  exit 1
fi
rm -rf "$DST"
mkdir -p "$DST"
cp -R "$SRC"/. "$DST"/
echo "synced $SRC → $DST"
