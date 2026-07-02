#!/bin/bash
set -e

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TAURI_DIR="$APP_DIR/src-tauri"
RELEASE="$TAURI_DIR/target/release"
STAGING="$RELEASE/msix-staging"
BUNDLE="$RELEASE/bundle"
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

echo "=== Building Tauri app ==="
cd "$APP_DIR"
export PATH="$PATH:$HOME/.cargo/bin"
npx tauri build

echo "=== Preparing MSIX staging ==="
mkdir -p "$STAGING/Assets"
cp "$RELEASE/sypnose-registry.exe" "$STAGING/"
cp "$TAURI_DIR/icons/Square150x150Logo.png" "$STAGING/Assets/"
cp "$TAURI_DIR/icons/Square44x44Logo.png" "$STAGING/Assets/"
cp "$TAURI_DIR/icons/StoreLogo.png" "$STAGING/Assets/"
cp "$TAURI_DIR/icons/Square310x310Logo.png" "$STAGING/Assets/Wide310x150Logo.png"

echo "=== Creating MSIX ==="
mkdir -p "$BUNDLE"
MSYS_NO_PATHCONV=1 "$MAKEAPPX" pack \
  /d "$(cygpath -w "$STAGING")" \
  /p "$(cygpath -w "$BUNDLE/Registry_0.1.0_x64.msix")" \
  /o

echo "=== Signing MSIX ==="
MSYS_NO_PATHCONV=1 "$SIGNTOOL" sign \
  /fd SHA256 /a \
  /f "$(cygpath -w "$CERT")" \
  /p "$CERT_PASS" \
  "$(cygpath -w "$BUNDLE/Registry_0.1.0_x64.msix")"

echo "=== DONE ==="
echo "MSIX: $BUNDLE/Registry_0.1.0_x64.msix"
echo "NSIS: $BUNDLE/nsis/Sypnose Registry_0.1.0_x64-setup.exe"
echo "MSI:  $BUNDLE/msi/Sypnose Registry_0.1.0_x64_en-US.msi"
