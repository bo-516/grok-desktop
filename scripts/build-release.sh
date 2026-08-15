#!/usr/bin/env bash
# Build distributable grok-desktop bundles into release/.
#
#   bash scripts/build-release.sh            # both targets, version from package.json
#   bash scripts/build-release.sh mac        # macOS universal .app only
#   bash scripts/build-release.sh windows    # Windows amd64 only
#   VERSION=0.2.0 bash scripts/build-release.sh
#
# Each bundle ships two binaries: the Wails shell and the Go bridge it spawns.
# The shell finds the bridge next to its own executable (Windows) or in
# Contents/Resources (macOS) — see apps/shell/paths.go.
#
# Icons come from apps/shell/icons/: icon.icns is copied into the bundle, and
# the Windows .exe icon rides in the committed apps/shell/rsrc_windows_amd64.syso
# that `go build` links automatically. Both regenerate from appicon.svg via
# scripts/build-icons.mjs.
#
# Linux is not built here: Wails needs cgo + webkit2gtk, which cannot cross-
# compile from macOS. Build it on a Linux host with apps/shell/build/build.sh.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/release"
APP_NAME="Grok Desktop"
BUNDLE_ID="io.github.bo516.grokdesktop"

TARGET="${1:-all}"
VERSION="${VERSION:-$(node -p "require('$ROOT/package.json').version")}"

log() { printf '\033[1;36m==>\033[0m %s\n' "$*"; }

# --- frontend (platform independent, embedded into every shell binary) -------
build_frontend() {
  log "frontend → apps/desktop/dist"
  npm run build -w @grok-desktop/desktop --prefix "$ROOT" >/dev/null
  bash "$ROOT/apps/shell/build/sync-frontend.sh" >/dev/null
}

# --- macOS: universal .app --------------------------------------------------
build_mac() {
  local app="$OUT/$APP_NAME.app"
  local macos="$app/Contents/MacOS"
  local resources="$app/Contents/Resources"
  local tmp="$OUT/.mac-tmp"

  log "macOS bridge (arm64 + amd64)"
  mkdir -p "$tmp"
  (cd "$ROOT/apps/bridge-go" &&
    GOOS=darwin GOARCH=arm64 CGO_ENABLED=0 go build -o "$tmp/bridge-arm64" ./cmd/bridge &&
    GOOS=darwin GOARCH=amd64 CGO_ENABLED=0 go build -o "$tmp/bridge-amd64" ./cmd/bridge)

  log "macOS shell (arm64 + amd64)"
  # CGO is required for WKWebView; clang cross-compiles the amd64 slice on Apple silicon.
  (cd "$ROOT/apps/shell" &&
    GOOS=darwin GOARCH=arm64 CGO_ENABLED=1 go build -o "$tmp/shell-arm64" . 2>/dev/null &&
    GOOS=darwin GOARCH=amd64 CGO_ENABLED=1 go build -o "$tmp/shell-amd64" . 2>/dev/null)

  log "assembling $APP_NAME.app"
  rm -rf "$app"
  mkdir -p "$macos" "$resources"
  lipo -create -output "$macos/grok-desktop" "$tmp/shell-arm64" "$tmp/shell-amd64"
  lipo -create -output "$resources/bridge-go" "$tmp/bridge-arm64" "$tmp/bridge-amd64"
  chmod +x "$macos/grok-desktop" "$resources/bridge-go"
  cp "$ROOT/apps/shell/icons/icon.icns" "$resources/icon.icns"
  rm -rf "$tmp"

  cat >"$app/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>$APP_NAME</string>
  <key>CFBundleDisplayName</key><string>$APP_NAME</string>
  <key>CFBundleExecutable</key><string>grok-desktop</string>
  <key>CFBundleIconFile</key><string>icon</string>
  <key>CFBundleIdentifier</key><string>$BUNDLE_ID</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$VERSION</string>
  <key>CFBundleVersion</key><string>$VERSION</string>
  <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
  <key>LSApplicationCategoryType</key><string>public.app-category.developer-tools</string>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
PLIST

  # lipo strips the per-slice signature Go writes; arm64 refuses to launch unsigned.
  log "ad-hoc signing (not notarized — users must clear quarantine)"
  codesign --force --deep --sign - "$app"
  codesign --verify --deep "$app"

  # Asset names stay unversioned so README can link
  # releases/latest/download/<name> forever.
  local zip="$OUT/Grok-Desktop-macos-universal.zip"
  rm -f "$zip"
  ditto -c -k --sequesterRsrc --keepParent "$app" "$zip"
  log "built $zip"
}

# --- Windows: amd64 folder --------------------------------------------------
build_windows() {
  local dir="$OUT/Grok-Desktop-windows-amd64"

  log "Windows shell + bridge (amd64)"
  rm -rf "$dir"
  mkdir -p "$dir"
  # Wails loads WebView2 through go-winloader, so no cgo toolchain is needed.
  (cd "$ROOT/apps/shell" &&
    GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -o "$dir/grok-desktop.exe" .)
  (cd "$ROOT/apps/bridge-go" &&
    GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -o "$dir/bridge-go.exe" ./cmd/bridge)

  cat >"$dir/README.txt" <<'TXT'
Grok Desktop — Windows

1. Keep grok-desktop.exe and bridge-go.exe in the same folder; the app spawns
   the bridge from its own directory.
2. Install the grok CLI and sign in, or set GROK_BIN to its path.
3. Windows 10 also needs the Microsoft Edge WebView2 Runtime (Windows 11 has it).
   https://developer.microsoft.com/microsoft-edge/webview2/

Logs: %LOCALAPPDATA%\grok-desktop\logs
TXT

  local zip="$dir.zip"
  rm -f "$zip"
  (cd "$OUT" && zip -qr "$(basename "$zip")" "$(basename "$dir")")
  log "built $zip"
}

mkdir -p "$OUT"
build_frontend
case "$TARGET" in
  mac | macos | darwin) build_mac ;;
  win | windows) build_windows ;;
  all)
    build_mac
    build_windows
    ;;
  *)
    echo "unknown target: $TARGET (use mac | windows | all)" >&2
    exit 1
    ;;
esac

log "artifacts in $OUT"
ls -lh "$OUT" | grep -E '\.zip$' || true
