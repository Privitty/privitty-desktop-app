#!/usr/bin/env bash
# =============================================================================
# sign-mac.sh
#
# Signs and notarizes a macOS DMG produced unsigned by CI.
# Run locally on a macOS machine with your Developer ID certificate.
#
# What this script signs (inside-out order, required by codesign):
#   1. Individual .dylib / executables inside Frameworks
#   2. Framework bundles (.framework)
#   3. Electron Helper .app bundles
#   4. Unpacked native binaries in app.asar.unpacked/:
#        privitty-server          (universal fat binary)
#        stdio-rpc-server         (universal fat binary)
#   5. Main PrivittyChat.app bundle
#   6. The DMG container itself
#   Then: notarize + staple
#
# Prerequisites:
#   macOS machine with Xcode Command Line Tools (codesign, xcrun, hdiutil)
#   "Developer ID Application: ..." certificate in your login Keychain
#   App-Specific Password from https://appleid.apple.com
#
# Required environment variables:
#   APPLE_ID           your-apple-id@example.com
#   APPLE_ID_PASSWORD  app-specific-password (xxxx-xxxx-xxxx-xxxx)
#   APPLE_TEAM_ID      10-character team ID from developer.apple.com
#   SIGNING_IDENTITY   "Developer ID Application: Privitty Inc (TEAMID)"
#
# Usage:
#   export APPLE_ID="you@example.com"
#   export APPLE_ID_PASSWORD="abcd-efgh-ijkl-mnop"
#   export APPLE_TEAM_ID="ABCD123456"
#   export SIGNING_IDENTITY="Developer ID Application: Privitty Inc (ABCD123456)"
#   bash build/sign-mac.sh dist/PrivittyChat-1.0.0-universal.dmg
#
# Output: PrivittyChat-1.0.0-universal-signed.dmg  (signed + notarized)
# =============================================================================
set -euo pipefail

UNSIGNED_DMG="${1:-}"
[[ -z "$UNSIGNED_DMG" ]] && { echo "Usage: $0 <path-to-unsigned.dmg>"; exit 1; }
[[ -f "$UNSIGNED_DMG" ]] || { echo "ERROR: File not found: $UNSIGNED_DMG"; exit 1; }

: "${APPLE_ID:?         Set APPLE_ID env var}"
: "${APPLE_ID_PASSWORD:? Set APPLE_ID_PASSWORD env var}"
: "${APPLE_TEAM_ID:?    Set APPLE_TEAM_ID env var}"
: "${SIGNING_IDENTITY:? Set SIGNING_IDENTITY (e.g. 'Developer ID Application: Privitty Inc (TEAMID)')}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENTITLEMENTS="$SCRIPT_DIR/entitlements.mac.plist"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

DMG_BASENAME="$(basename "${UNSIGNED_DMG%.dmg}")"
OUTPUT_DMG="${DMG_BASENAME}-signed.dmg"

log()  { printf '\n▶  %s\n' "$*"; }
step() { printf '\n── %s ──────────────────────────────────────\n' "$*"; }
ok()   { printf '   ✓  %s\n' "$*"; }
warn() { printf '   ⚠  %s\n' "$*"; }
die()  { printf '\nERROR: %s\n' "$*" >&2; exit 1; }

CODESIGN_BASE=(
  codesign
  --force
  --options runtime
  --timestamp
  --sign "$SIGNING_IDENTITY"
  --entitlements "$ENTITLEMENTS"
)

# Sign a single file; exit non-zero on failure (no || true).
sign_macho() {
  local f="$1"
  # Skip if not a Mach-O binary (check magic bytes via `file`)
  if file "$f" 2>/dev/null | grep -qE "Mach-O|executable|dylib|bundle"; then
    printf '   signing  %s\n' "${f#"$UNSIGNED_APP"/}"
    "${CODESIGN_BASE[@]}" "$f"
    ok "signed"
  fi
}

# ── Step 1: Extract .app from the unsigned DMG ───────────────────────────────
step "1/6  Extract .app from unsigned DMG"

MOUNT_POINT="$WORK_DIR/mnt"
mkdir -p "$MOUNT_POINT"

hdiutil attach "$UNSIGNED_DMG" \
  -mountpoint "$MOUNT_POINT" \
  -nobrowse -readonly -quiet

APP_NAME=$(find "$MOUNT_POINT" -maxdepth 1 -name "*.app" -type d \
             | head -1 | xargs basename 2>/dev/null || true)
if [[ -z "$APP_NAME" ]]; then
  hdiutil detach "$MOUNT_POINT" -quiet
  die "No .app found in $UNSIGNED_DMG"
fi

log "App bundle: $APP_NAME"
cp -R "$MOUNT_POINT/$APP_NAME" "$WORK_DIR/$APP_NAME"
hdiutil detach "$MOUNT_POINT" -quiet

UNSIGNED_APP="$WORK_DIR/$APP_NAME"

# ── Step 2: Sign dylibs / executables inside Frameworks (deepest first) ──────
step "2/6  Sign Frameworks contents (inside-out)"

while IFS= read -r -d '' f; do
  sign_macho "$f"
done < <(find "$UNSIGNED_APP/Contents/Frameworks" \
              -type f \( -name "*.dylib" -o -perm +111 \) \
              -print0 2>/dev/null \
         | sort -rz)

# ── Step 3: Sign .framework and .app helper bundles ──────────────────────────
step "3/6  Sign Framework bundles and Helper .app bundles"

while IFS= read -r -d '' fw; do
  printf '   signing framework  %s\n' "${fw#"$UNSIGNED_APP"/}"
  "${CODESIGN_BASE[@]}" "$fw"
  ok "signed"
done < <(find "$UNSIGNED_APP/Contents/Frameworks" -name "*.framework" -type d -print0 2>/dev/null)

while IFS= read -r -d '' helper; do
  printf '   signing helper     %s\n' "${helper#"$UNSIGNED_APP"/}"
  "${CODESIGN_BASE[@]}" "$helper"
  ok "signed"
done < <(find "$UNSIGNED_APP/Contents" -name "*.app" -type d -print0 2>/dev/null)

# ── Step 4: Sign native binaries in app.asar.unpacked ────────────────────────
# These are the third-party binaries Electron spawns as child processes.
# They MUST be individually signed with Hardened Runtime for notarization.
step "4/6  Sign native binaries in app.asar.unpacked"

UNPACKED_NM="$UNSIGNED_APP/Contents/Resources/app.asar.unpacked/node_modules"

if [[ -d "$UNPACKED_NM" ]]; then
  # Sign all executable files in the unpacked node_modules (deepest first).
  while IFS= read -r -d '' bin; do
    sign_macho "$bin"
  done < <(find "$UNPACKED_NM" -type f \( -perm +111 -o -name "*.node" \) \
                -print0 2>/dev/null | sort -rz)

  # Explicit check: confirm the two critical Privitty binaries were signed.
  for expected_bin in \
    "@privitty/stdio-rpc-server-darwin-universal/deltachat-rpc-server" \
    "@privitty/privitty-core-darwin-universal/privitty-server"
  do
    bin_path="$UNPACKED_NM/$expected_bin"
    if [[ -f "$bin_path" ]]; then
      if codesign --verify --strict "$bin_path" 2>/dev/null; then
        ok "verified  $expected_bin"
      else
        die "Signature verification FAILED for $expected_bin"
      fi
    else
      warn "Not found (may be OK for this build): $expected_bin"
    fi
  done
else
  warn "app.asar.unpacked/node_modules not found — skipping"
fi

# ── Step 5: Sign the main .app bundle ────────────────────────────────────────
step "5/6  Sign main .app bundle"

log "Signing $APP_NAME ..."
"${CODESIGN_BASE[@]}" "$UNSIGNED_APP"

log "Deep verification ..."
codesign --verify --deep --strict --verbose=1 "$UNSIGNED_APP" \
  && ok "Deep signature valid"

# ── Step 6: Package into a new signed DMG, sign it, notarize, staple ─────────
step "6/6  Package DMG → notarize → staple"

STAGING="$WORK_DIR/staging"
mkdir -p "$STAGING"
cp -R "$UNSIGNED_APP" "$STAGING/"
ln -s /Applications "$STAGING/Applications"

log "Creating DMG ..."
hdiutil create \
  -volname "PrivittyChat" \
  -srcfolder "$STAGING" \
  -ov \
  -format UDZO \
  -imagekey zlib-level=9 \
  "$WORK_DIR/$OUTPUT_DMG"

log "Signing DMG container ..."
codesign \
  --force \
  --sign "$SIGNING_IDENTITY" \
  --timestamp \
  "$WORK_DIR/$OUTPUT_DMG"

log "Submitting for notarization (this takes 1-5 minutes) ..."
RESULT_JSON="$WORK_DIR/notarize.json"

xcrun notarytool submit "$WORK_DIR/$OUTPUT_DMG" \
  --apple-id       "$APPLE_ID" \
  --password       "$APPLE_ID_PASSWORD" \
  --team-id        "$APPLE_TEAM_ID" \
  --wait \
  --output-format json \
  | tee "$RESULT_JSON"

STATUS=$(node -p "require('$RESULT_JSON').status" 2>/dev/null || echo "unknown")
if [[ "$STATUS" != "Accepted" ]]; then
  log "Fetching notarization log for diagnostics ..."
  SUB_ID=$(node -p "require('$RESULT_JSON').id" 2>/dev/null || echo "")
  [[ -n "$SUB_ID" ]] && xcrun notarytool log "$SUB_ID" \
    --apple-id "$APPLE_ID" --password "$APPLE_ID_PASSWORD" \
    --team-id "$APPLE_TEAM_ID" || true
  die "Notarization failed with status: $STATUS"
fi
ok "Notarization accepted"

log "Stapling notarization ticket ..."
xcrun stapler staple "$WORK_DIR/$OUTPUT_DMG"

cp "$WORK_DIR/$OUTPUT_DMG" "./$OUTPUT_DMG"

echo
echo "═══════════════════════════════════════════════════════"
echo "  ✓  Ready for distribution: ./$OUTPUT_DMG"
echo "═══════════════════════════════════════════════════════"
