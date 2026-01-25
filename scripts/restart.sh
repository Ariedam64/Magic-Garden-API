#!/bin/bash
# Redemarrage de l'API Magic Garden

set -e

APP_NAME="mg-api"

echo "=== Redemarrage de $APP_NAME ==="

# Verifier si l'app existe dans PM2
if pm2 describe "$APP_NAME" > /dev/null 2>&1; then
    pm2 restart "$APP_NAME"
    echo "API redemarree avec succes"
else
    echo "L'application '$APP_NAME' n'existe pas dans PM2"
    echo "Lancement initial..."
    cd "$(dirname "$0")/.."
    pm2 start src/index.js --name "$APP_NAME"
    pm2 save
fi

echo ""
pm2 status "$APP_NAME"
