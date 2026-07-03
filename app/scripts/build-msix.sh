#!/bin/bash
set -e

# ============================================================================
# Sypnose Registry — reproducible MSIX build (single canonical pipeline)
# ============================================================================
# One pipeline, one manifest. Historically two divergent manifests coexisted
# (msix-package/ and src-tauri/msix-staging/). The one that actually shipped is
# src-tauri/msix-staging/AppxManifest.xml (Name=...Registry, WITH internetClient
# — required because the M4 chat calls api.anthropic.com and the AI Bridge runs
# on :44444). This script now uses THAT manifest as the single source of truth.
#
# Version is parametrized (VERSION below / $MSIX_VERSION env). Bump it in ONE
# place and it flows to the artifact filename. Keep it in sync with:
#   - app/src-tauri/msix-staging/AppxManifest.xml  (Version="X.Y.Z.0")
#   - app/src-tauri/tauri.conf.json                (version "X.Y.Z")
#   - app/src-tauri/Cargo.toml / app/package.json  (version "X.Y.Z")
#
# Secrets: the cert password is NEVER hardcoded. It is read from
# D:\CERTIFICADO\pass.txt (outside the repo) or from the CERT_PASS env var.
# ============================================================================

VERSION="${MSIX_VERSION:-2.0.0}"

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TAURI_DIR="$APP_DIR/src-tauri"
RELEASE="$TAURI_DIR/target/release"
STAGING="$RELEASE/msix-staging"
BUNDLE="$RELEASE/bundle"
OUT_MSIX="$BUNDLE/msix/SypnoseRegistry_${VERSION}_x64.msix"
OUT_CER="$BUNDLE/msix/SypnoseRegistry.cer"
MAKEAPPX="/c/Program Files (x86)/Windows Kits/10/bin/10.0.19041.0/x64/makeappx.exe"
SIGNTOOL="/c/Program Files (x86)/Windows Kits/10/bin/10.0.19041.0/x64/signtool.exe"
CERT="/d/CERTIFICADO/RepackagerExpress_renewed.pfx"

# Password NUNCA hardcodeado: se lee de D:\CERTIFICADO\pass.txt (fuera del repo)
# o de la variable de entorno CERT_PASS.
if [ -z "$CERT_PASS" ] && [ -f "/d/CERTIFICADO/pass.txt" ]; then
  CERT_PASS="$(tr -d '\r\n' < /d/CERTIFICADO/pass.txt)"
fi
if [ -z "$CERT_PASS" ]; then
  echo "ERROR: define CERT_PASS o crea D:\\CERTIFICADO\\pass.txt" >&2
  exit 1
fi

echo "=== Building Tauri app (v$VERSION) ==="
cd "$APP_DIR"
export PATH="$PATH:$HOME/.cargo/bin"
npx tauri build

echo "=== Preparing MSIX staging ==="
# Canonical, version-controlled staging source (manifest + assets). This is the
# single source of truth for the MSIX layout. We build a CLEAN working copy under
# target/release so nothing stale from a previous run leaks in.
SRC_STAGING="$TAURI_DIR/msix-staging"
rm -rf "$STAGING"
mkdir -p "$STAGING/Assets"
# Manifest (already at v$VERSION in the tracked source) + assets, verbatim.
cp "$SRC_STAGING/AppxManifest.xml" "$STAGING/"
cp "$SRC_STAGING/Assets/"* "$STAGING/Assets/" 2>/dev/null || true
# Binaries — overlay the FRESHLY built release binary (has M1-M5), NOT the stale
# copy that may be committed under the tracked staging dir. The manifest's
# Executable is "sypnose-registry.exe", so keep that exact name.
cp "$RELEASE/sypnose-registry.exe" "$STAGING/sypnose-registry.exe"
cp "$RELEASE/app_lib.dll" "$STAGING/" 2>/dev/null || true

echo "=== Creating MSIX ==="
mkdir -p "$BUNDLE/msix"
MSYS_NO_PATHCONV=1 "$MAKEAPPX" pack \
  /d "$(cygpath -w "$STAGING")" \
  /p "$(cygpath -w "$OUT_MSIX")" \
  /o

echo "=== Signing MSIX ==="
MSYS_NO_PATHCONV=1 "$SIGNTOOL" sign \
  /fd SHA256 /a \
  /f "$(cygpath -w "$CERT")" \
  /p "$CERT_PASS" \
  "$(cygpath -w "$OUT_MSIX")"

echo "=== Verifying signature ==="
MSYS_NO_PATHCONV=1 "$SIGNTOOL" verify /pa "$(cygpath -w "$OUT_MSIX")"

echo "=== Exporting public certificate (.cer) for sideload trust ==="
# The public cert lets a stranger trust the package (Import-Certificate into
# Trusted People) before installing. Extracted from the signed MSIX.
powershell.exe -NoProfile -Command \
  "(Get-AuthenticodeSignature '$(cygpath -w "$OUT_MSIX")').SignerCertificate | Export-Certificate -FilePath '$(cygpath -w "$OUT_CER")' -Type CERT | Out-Null" \
  || echo "WARN: no pude exportar el .cer automaticamente; hazlo manual (ver README)."

echo "=== SHA256 ==="
sha256sum "$OUT_MSIX" | tee "$BUNDLE/msix/SypnoseRegistry_${VERSION}_x64.msix.sha256"

echo "=== DONE ==="
echo "MSIX: $OUT_MSIX"
echo "CER:  $OUT_CER"
echo "NSIS: $BUNDLE/nsis/Sypnose Registry_${VERSION}_x64-setup.exe"
echo "MSI:  $BUNDLE/msi/Sypnose Registry_${VERSION}_x64_en-US.msi"
