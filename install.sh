#!/bin/bash
# Installs or updates Quick Broadcast into ~/quick-broadcast (Mac / Linux).
# Usage: curl -fsSL https://raw.githubusercontent.com/Srekaravarshan/quick-broadcast/main/install.sh | bash
set -euo pipefail

DEST="$HOME/quick-broadcast"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

curl -fsSL https://github.com/Srekaravarshan/quick-broadcast/archive/refs/heads/main.zip -o "$TMP/qb.zip"
unzip -q "$TMP/qb.zip" -d "$TMP"
rm -rf "$DEST"
mv "$TMP/quick-broadcast-main" "$DEST"

echo "Quick Broadcast is ready in: $DEST"
echo "First time : chrome://extensions -> Developer mode ON -> Load unpacked -> pick that folder"
echo "Updating   : chrome://extensions -> click the reload icon on Quick Broadcast"
command -v open >/dev/null && open "$DEST" || true
