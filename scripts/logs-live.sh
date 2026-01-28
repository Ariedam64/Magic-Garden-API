#!/bin/bash
# Affiche les logs de l'API en temps reel (PM2)

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

pm2 logs "$APP_NAME"
