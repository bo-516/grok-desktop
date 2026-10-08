#!/usr/bin/env bash
# Code signing helpers for scripts/build-release.sh. Source this file; do not
# run it as the build. With no credentials the macOS path stays ad-hoc
# (`codesign --sign -`) and Windows binaries stay unsigned.
#
# macOS Developer ID + notarization (either credential style):
#   MACOS_SIGN_IDENTITY="Developer ID Application: Example (TEAMID)"
#   MACOS_NOTARY_KEYCHAIN_PROFILE="grok-desktop-notary"
#     — profile created once with `xcrun notarytool store-credentials`
#   OR the App Store Connect API key (CI, no keychain prompt):
#   APPLE_API_KEY=/path/to/AuthKey_XXXX.p8   # file path, not the key text
#   APPLE_API_KEY_ID=XXXX
#   APPLE_API_ISSUER=issuer-uuid
#   When both styles are set, the keychain profile wins.
#   Identity without notarization credentials signs and prints a notice.
#   Notarization credentials without an identity abort the build.
#
# Windows Authenticode (optional):
#   WINDOWS_SIGN_PFX=/path/to/codesign.pfx
#   WINDOWS_SIGN_PFX_PASSWORD=secret          # may be empty
#   On Windows, signtool (Windows SDK) is used when it is on PATH.
#   Otherwise osslsigncode (Homebrew: brew install osslsigncode).
#   A set PFX with neither tool on PATH aborts. An unset PFX skips signing.
#
# RELEASE_SIGN_DRY_RUN=1 prints the signing commands and does not run them.
# Do not ship a zip produced that way.
#
# Requires bash 3.2 (the macOS /bin/bash). No namerefs, no mapfile.

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  echo "Source this file from scripts/build-release.sh."
  echo "It defines sign_macos_app, notarize_macos_app, and sign_windows_files."
  exit 0
fi

# log is provided by build-release.sh. A fallback keeps direct `source` usable.
if ! declare -F log >/dev/null 2>&1; then
  log() { printf '==> %s\n' "$*"; }
fi

# release_repo_root is the monorepo root that holds apps/shell/build/darwin.
# BASH_SOURCE is this file even when the function runs from build-release.sh.
# The cd is inside a command substitution so the caller's cwd does not change.
release_repo_root() {
  cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd
}

# macos_identity_configured is true when a real Developer ID (or other
# codesigning identity) should be used. Empty, "-", and "adhoc" keep today's
# ad-hoc signature.
macos_identity_configured() {
  local id="${MACOS_SIGN_IDENTITY:-}"
  [[ -n "$id" && "$id" != "-" && "$id" != "adhoc" ]]
}

# macos_notary_configured is true when notarytool has either a keychain
# profile or a complete App Store Connect API key triple.
macos_notary_configured() {
  if [[ -n "${MACOS_NOTARY_KEYCHAIN_PROFILE:-}" ]]; then
    return 0
  fi
  if [[ -n "${APPLE_API_KEY:-}" && -n "${APPLE_API_KEY_ID:-}" && -n "${APPLE_API_ISSUER:-}" ]]; then
    return 0
  fi
  return 1
}

# release_sign_dry_run is true when commands must be printed instead of run.
release_sign_dry_run() {
  [[ "${RELEASE_SIGN_DRY_RUN:-}" == "1" ]]
}

# run_or_dry executes the given command, or prints it quoted when dry-run is set.
# A failing command aborts the caller (set -e). Dry-run always returns 0.
# Arguments are the argv of the tool. The password, when present, is part of
# that argv and will show up in the dry-run line and in the process list.
run_or_dry() {
  if release_sign_dry_run; then
    printf 'dry-run:'
    printf ' %q' "$@"
    printf '\n'
    return 0
  fi
  "$@"
}

# sign_macos_app signs Grok Desktop.app.
# Inner binary first: Contents/Resources/bridge-go, then the bundle (which
# seals Contents/MacOS/grok-desktop). No --deep on the Developer ID path;
# --deep re-signs nested code with the wrong entitlements.
# Without MACOS_SIGN_IDENTITY this is `codesign --force --deep --sign -`,
# matching the historical ad-hoc behavior, plus a notice.
# @param $1 Absolute or relative path to the .app bundle.
# Missing bundle (and not dry-run), or notarization creds without an identity,
# return 1. codesign's own failure also returns non-zero.
sign_macos_app() {
  local app="$1"
  local root bridge shell_ent bridge_ent
  root="$(release_repo_root)"
  bridge="$app/Contents/Resources/bridge-go"
  shell_ent="$root/apps/shell/build/darwin/entitlements.plist"
  bridge_ent="$root/apps/shell/build/darwin/entitlements-bridge.plist"

  if ! macos_identity_configured; then
    if macos_notary_configured; then
      echo "notarization credentials are set but MACOS_SIGN_IDENTITY is empty." >&2
      echo "Refusing to notarize an ad-hoc signature. Set MACOS_SIGN_IDENTITY." >&2
      return 1
    fi
    log "notice: MACOS_SIGN_IDENTITY unset — ad-hoc signature only (not notarized)."
    log "notice: a browser download must clear quarantine (xattr) or be allowed in Privacy & Security."
    log "notice: set MACOS_SIGN_IDENTITY plus notarization credentials for a Gatekeeper-clean build."
    if release_sign_dry_run; then
      run_or_dry codesign --force --deep --sign - "$app"
      return 0
    fi
    if [[ ! -d "$app" ]]; then
      echo "sign_macos_app: not a directory: $app" >&2
      return 1
    fi
    codesign --force --deep --sign - "$app"
    codesign --verify --deep "$app"
    return 0
  fi

  if ! release_sign_dry_run && [[ ! -d "$app" ]]; then
    echo "sign_macos_app: not a directory: $app" >&2
    return 1
  fi
  if [[ ! -f "$shell_ent" || ! -f "$bridge_ent" ]]; then
    echo "sign_macos_app: entitlements missing under $root/apps/shell/build/darwin" >&2
    return 1
  fi

  log "Developer ID signing (hardened runtime, bridge then app)"
  run_or_dry codesign --force --options runtime --timestamp \
    --entitlements "$bridge_ent" \
    --sign "$MACOS_SIGN_IDENTITY" \
    "$bridge"
  run_or_dry codesign --force --options runtime --timestamp \
    --entitlements "$shell_ent" \
    --sign "$MACOS_SIGN_IDENTITY" \
    "$app"
  if ! release_sign_dry_run; then
    codesign --verify --deep --strict "$app"
  fi
}

# notarize_macos_app submits the zip to notarytool, staples the ticket into
# the .app, and rewrites the zip so the shipped archive contains the ticket.
# No-op (with a notice if the app was Developer ID signed) when credentials
# are absent. Identity is required when credentials are present.
# @param $1 Path to the .app (staple target).
# @param $2 Path to the zip notarytool should upload. Replaced after staple
#           unless dry-run is set.
notarize_macos_app() {
  local app="$1"
  local zip="$2"
  if ! macos_notary_configured; then
    if macos_identity_configured; then
      log "notice: Developer ID signature present, notarization skipped."
      log "notice: set MACOS_NOTARY_KEYCHAIN_PROFILE, or APPLE_API_KEY + APPLE_API_KEY_ID + APPLE_API_ISSUER."
      log "notice: without a ticket, Gatekeeper still warns on browser downloads."
    fi
    return 0
  fi
  if ! macos_identity_configured; then
    echo "notarization requested without MACOS_SIGN_IDENTITY" >&2
    return 1
  fi

  log "submitting $(basename "$zip") to the Apple notary service"
  if [[ -n "${MACOS_NOTARY_KEYCHAIN_PROFILE:-}" ]]; then
    run_or_dry xcrun notarytool submit "$zip" --wait --timeout 30m \
      --keychain-profile "$MACOS_NOTARY_KEYCHAIN_PROFILE"
  else
    run_or_dry xcrun notarytool submit "$zip" --wait --timeout 30m \
      --key "$APPLE_API_KEY" \
      --key-id "$APPLE_API_KEY_ID" \
      --issuer "$APPLE_API_ISSUER"
  fi
  log "stapling notarization ticket"
  run_or_dry xcrun stapler staple "$app"
  if release_sign_dry_run; then
    return 0
  fi
  xcrun stapler validate "$app"
  codesign --verify --deep --strict "$app"
  rm -f "$zip"
  ditto -c -k --sequesterRsrc --keepParent "$app" "$zip"
  log "stapled and re-zipped $zip"
}

# sign_windows_files Authenticode-signs each exe passed as an argument.
# Unset WINDOWS_SIGN_PFX prints a SmartScreen notice and returns 0.
# A set PFX that is missing, or no signtool/osslsigncode (unless dry-run),
# returns 1. Dry-run with neither tool prints an osslsigncode command, which
# is the cross-build path from macOS.
# signtool wins when both tools exist (native Windows SDK).
# osslsigncode writes a sibling .signed file and replaces the original.
# @param $@ Absolute paths of the .exe files, shell first or bridge first;
#           order does not matter for Authenticode.
sign_windows_files() {
  local pass tool f tmp
  if [[ -z "${WINDOWS_SIGN_PFX:-}" ]]; then
    log "notice: WINDOWS_SIGN_PFX unset — Windows binaries stay unsigned (SmartScreen may warn)."
    return 0
  fi
  if [[ $# -lt 1 ]]; then
    echo "sign_windows_files: WINDOWS_SIGN_PFX is set but no files were given" >&2
    return 1
  fi
  if ! release_sign_dry_run && [[ ! -f "$WINDOWS_SIGN_PFX" ]]; then
    echo "WINDOWS_SIGN_PFX not found: $WINDOWS_SIGN_PFX" >&2
    return 1
  fi
  pass="${WINDOWS_SIGN_PFX_PASSWORD:-}"
  tool=""
  if command -v signtool >/dev/null 2>&1; then
    tool="signtool"
  elif command -v osslsigncode >/dev/null 2>&1; then
    tool="osslsigncode"
  elif release_sign_dry_run; then
    tool="osslsigncode"
  else
    echo "WINDOWS_SIGN_PFX is set but neither signtool nor osslsigncode is on PATH." >&2
    echo "Windows: install the Windows SDK. macOS cross-build: brew install osslsigncode." >&2
    return 1
  fi

  log "Authenticode signing with $tool"
  for f in "$@"; do
    if [[ "$tool" == "signtool" ]]; then
      # MSYS_NO_PATHCONV stops Git Bash rewriting /fd into a filesystem path.
      # signtool itself still receives /fd. The env prefix applies to run_or_dry
      # and to the signtool child it execs.
      MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*' \
        run_or_dry signtool sign /fd SHA256 /td SHA256 /tr http://timestamp.digicert.com \
        /f "$WINDOWS_SIGN_PFX" /p "$pass" "$f"
    else
      tmp="${f}.signed"
      run_or_dry osslsigncode sign \
        -pkcs12 "$WINDOWS_SIGN_PFX" \
        -pass "$pass" \
        -n "Grok Desktop" \
        -i "https://github.com/bo-516/grok-desktop" \
        -h sha256 \
        -ts http://timestamp.digicert.com \
        -in "$f" \
        -out "$tmp"
      if ! release_sign_dry_run; then
        mv "$tmp" "$f"
      fi
    fi
  done
}
