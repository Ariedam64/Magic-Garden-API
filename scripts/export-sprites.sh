#!/bin/bash
# Export des sprites Magic Garden vers le disque

set -e

cd "$(dirname "$0")/.."

# Dossier de sortie (par défaut: sprites_dump)
OUT_DIR="${1:-./sprites_dump}"

echo "=== Export des sprites Magic Garden ==="
echo "Dossier de sortie: $OUT_DIR"
echo ""

node src/assets/sprites/exportSpritesToDisk.js "$OUT_DIR"

echo ""
echo "=== Export termine ==="
