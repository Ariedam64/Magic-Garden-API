#!/bin/bash
# Redemarrage de l'API Magic Garden + Nginx

set -e

APP_NAME="mg-api"
PROJECT_DIR="$(dirname "$0")/.."

echo "=== Redemarrage de $APP_NAME ==="

# 1. Mettre a jour et recharger Nginx
echo ""
echo "--- Mise a jour Nginx ---"
sudo cp "$PROJECT_DIR/nginx.conf" /etc/nginx/sites-available/mg-api
if sudo nginx -t; then
    sudo systemctl reload nginx
    echo "Nginx recharge avec succes"
else
    echo "Erreur de configuration Nginx!"
    exit 1
fi

# 2. Redemarrer l'API
echo ""
echo "--- Redemarrage API ---"
cd "$PROJECT_DIR"

if pm2 describe "$APP_NAME" > /dev/null 2>&1; then
    pm2 restart "$APP_NAME"
    echo "API redemarree avec succes"
else
    echo "L'application '$APP_NAME' n'existe pas dans PM2"
    echo "Lancement initial..."
    pm2 start src/index.js --name "$APP_NAME" --cwd "$PROJECT_DIR" --node-args="--env-file=.env"
    pm2 save
fi

echo ""
pm2 status "$APP_NAME"
