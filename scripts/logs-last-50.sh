#!/bin/bash
# Affiche les 50 derniers logs de l'API (PM2)

set -e

APP_NAME="mg-api"

if ! command -v pm2 >/dev/null 2>&1; then
  echo "PM2 n'est pas installe ou introuvable dans le PATH."
  exit 1
fi

if ! pm2 describe "$APP_NAME" >/dev/null 2>&1; then
  echo "L'application '$APP_NAME' n'existe pas dans PM2."
  exit 1
fi

if pm2 logs --help 2>/dev/null | grep -q -- "--nostream"; then
  pm2 logs "$APP_NAME" --lines 50 --nostream
  exit 0
fi

# Fallback si --nostream n'est pas supporte: lire les fichiers de logs PM2.
INFO_OUTPUT=$(pm2 info "$APP_NAME")
OUT_LOG=$(echo "$INFO_OUTPUT" | awk -F': ' '/out log path/ {print $2}')
ERR_LOG=$(echo "$INFO_OUTPUT" | awk -F': ' '/error log path/ {print $2}')

if [ -n "$OUT_LOG" ] && [ -f "$OUT_LOG" ]; then
  echo "--- out ---"
  tail -n 50 "$OUT_LOG"
fi

if [ -n "$ERR_LOG" ] && [ -f "$ERR_LOG" ]; then
  echo "--- error ---"
  tail -n 50 "$ERR_LOG"
fi
